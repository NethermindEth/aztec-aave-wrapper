/**
 * Deposit Phase 2: L1 Execution + L2 Finalization
 *
 * Resumes a pending deposit from Phase 1 (persisted PendingDeposit).
 * Covers steps 3-6 from executeDepositFlow:
 *   3. Compute L2→L1 message hash and fetch proof
 *   4. Wait for checkpoint proven, execute deposit on L1
 *   5. Wait for L1→L2 message to be consumable
 *   6. Call finalize_deposit on L2, remove pending deposit
 *
 * The secret is retrieved from encrypted localStorage (stored during Phase 1).
 * All PendingDeposit fields are strings — they are reconstituted to bigint/Fr/Hex here.
 */

import type { Address, Chain, Hex, PublicClient, Transport } from "viem";
// L1 Services
import type { L1Clients } from "../services/l1/client.js";
import type { DepositIntent } from "../services/l1/intent.js";
import { mineL1Block } from "../services/l1/mining.js";
import { executeDeposit, getIntentShares, type MerkleProof } from "../services/l1/portal.js";
// L2 Services
import type { AztecNodeClient } from "../services/l2/client.js";
import { bigIntToBytes32, hexToFr, sha256ToField } from "../services/l2/crypto.js";
import type { AaveWrapperContract } from "../services/l2/deploy.js";
import {
  computeLeafId,
  getOutboxVersion,
  hasMessageBeenConsumed,
  type L2ToL1MessageProofResult,
  waitForCheckpointProven,
  waitForL2ToL1MessageProof,
} from "../services/l2/messageProof.js";
import { executeFinalizeDeposit } from "../services/l2/operations.js";
import type { AztecAddress } from "../services/l2/wallet.js";
// Persistence services
import { type PendingDeposit, removePendingDeposit } from "../services/pendingDeposits.js";
import { getSecret } from "../services/secrets.js";
// Store
import {
  clearOperation,
  setOperationError,
  setOperationIntentId,
  setOperationStatus,
  setOperationStep,
  startOperation,
} from "../store/actions.js";
import { logInfo, logSection, logStep, logSuccess } from "../store/logger.js";
// Error types
import {
  isNetworkError,
  isTimeoutError,
  isUserRejection,
  NetworkError,
  TimeoutError,
  UserRejectedError,
} from "../types/errors.js";

// =============================================================================
// Types
// =============================================================================

/**
 * L1 contract addresses required for Phase 2.
 */
export interface Phase2L1Addresses {
  /** Portal contract address */
  portal: Address;
  /** Mock USDC token address */
  mockUsdc: Address;
  /** Aztec outbox address for L2→L1 message verification */
  aztecOutbox: Address;
}

/**
 * L2 context for Phase 2 operations.
 */
export interface Phase2L2Context {
  /** Aztec node client */
  node: AztecNodeClient;
  /** User wallet wrapper with address accessor */
  wallet: { address: AztecAddress };
  /** AaveWrapper contract instance */
  contract: AaveWrapperContract;
}

/**
 * Result of a successful Phase 2 execution.
 */
export interface DepositPhase2Result {
  /** Intent ID */
  intentId: string;
  /** Number of aToken shares received */
  shares: bigint;
  /** Transaction hashes for each step */
  txHashes: {
    l1Execute?: string;
    l2Finalize?: string;
  };
}

// =============================================================================
// Constants
// =============================================================================

/** Phase 2 has 4 steps: prepare, L1 execute, wait L1→L2, finalize L2 */
const PHASE2_TOTAL_STEPS = 4;

// =============================================================================
// Helper: Wait for L1→L2 Message
// =============================================================================

/**
 * Wait for L1→L2 message to be consumable by polling for membership witness.
 *
 * Duplicated from deposit.ts (private function) to keep Phase 2 self-contained.
 *
 * @returns true if message is ready, false if timeout
 */
async function waitForL1ToL2Message(
  publicClient: PublicClient<Transport, Chain>,
  node: AztecNodeClient,
  messageLeaf: Hex,
  maxWaitMs = 300_000,
  pollIntervalMs = 5000
): Promise<boolean> {
  const startTime = Date.now();
  const { Fr } = await import("@aztec/aztec.js/fields");

  const messageLeafFr = Fr.fromString(messageLeaf);

  let pollCount = 0;
  let lastBlockMined = Date.now();
  const minMineInterval = 10000;

  while (Date.now() - startTime < maxWaitMs) {
    pollCount++;

    try {
      const currentBlock = await node.getBlockNumber();
      const messageBlockNumber = await node.getL1ToL2MessageBlock(messageLeafFr);

      if (messageBlockNumber === undefined) {
        logInfo(
          `Poll ${pollCount}: Message not yet indexed by archiver (L2 block=${currentBlock})`
        );
      } else if (currentBlock < messageBlockNumber) {
        logInfo(
          `Poll ${pollCount}: Message available at block ${messageBlockNumber}, current=${currentBlock}`
        );
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const nodeAny = node as any;

        if (typeof nodeAny.getL1ToL2MembershipWitness === "function") {
          try {
            const witness = await nodeAny.getL1ToL2MembershipWitness(currentBlock, messageLeafFr);

            if (witness && witness.length > 0) {
              const elapsed = Math.round((Date.now() - startTime) / 1000);
              logSuccess(
                `L1→L2 message is consumable! (${elapsed}s, witness obtained at block ${currentBlock})`
              );
              return true;
            }
            logInfo(
              `Poll ${pollCount}: Block ${currentBlock} >= ${messageBlockNumber} but witness not yet available`
            );
          } catch (witnessError) {
            logInfo(
              `Poll ${pollCount}: Witness query failed: ${witnessError instanceof Error ? witnessError.message : "error"}`
            );
          }
        } else {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          logSuccess(
            `L1→L2 message indexed at block ${currentBlock} (${elapsed}s) - witness API not available`
          );
          return true;
        }
      }

      // Mine L1 block periodically to trigger archiver sync
      if (Date.now() - lastBlockMined > minMineInterval) {
        logInfo("Mining L1 block to trigger archiver sync...");
        try {
          await mineL1Block(publicClient);
        } catch {
          // Ignore mining errors
        }
        lastBlockMined = Date.now();
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    } catch (error) {
      logInfo(`Poll ${pollCount}: ${error instanceof Error ? error.message : "Error"}`);
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  logSection("L1→L2", `Message not consumable after ${elapsed}s`, "warning");
  return false;
}

// =============================================================================
// Phase 2 Flow
// =============================================================================

/**
 * Execute deposit Phase 2: L1 execution + L2 finalization.
 *
 * Takes a PendingDeposit (persisted during Phase 1) and executes:
 * 1. Compute L2→L1 message hash, fetch proof, wait for checkpoint
 * 2. Execute deposit on L1 via relayer
 * 3. Wait for L1→L2 message to be consumable
 * 4. Call finalize_deposit on L2
 * 5. Remove pending deposit from localStorage
 *
 * @param l1Clients - L1 public and wallet clients
 * @param l1Addresses - L1 contract addresses (portal, mockUsdc, aztecOutbox)
 * @param l2Context - L2 node, wallet, and contract
 * @param pending - The PendingDeposit from Phase 1
 * @returns Phase 2 result with shares and tx hashes
 *
 * @throws {UserRejectedError} If user rejects L1 transaction
 * @throws {NetworkError} If network/RPC call fails
 * @throws {TimeoutError} If message proof or checkpoint times out
 * @throws {Error} For other failures (missing secret, insufficient balance, etc.)
 */
export async function executeDepositPhase2(
  l1Clients: L1Clients,
  l1Addresses: Phase2L1Addresses,
  l2Context: Phase2L2Context,
  pending: PendingDeposit
): Promise<DepositPhase2Result> {
  const { publicClient, walletClient } = l1Clients;
  const { node, wallet, contract } = l2Context;
  const txHashes: DepositPhase2Result["txHashes"] = {};

  let currentStep = 0;

  startOperation("deposit", PHASE2_TOTAL_STEPS);
  setOperationIntentId(pending.intentId);

  try {
    // =========================================================================
    // Retrieve secret from encrypted storage
    // =========================================================================
    const l2AddressHex = wallet.address.toString();
    const secretEntry = await getSecret(pending.intentId, l2AddressHex);
    if (!secretEntry) {
      throw new Error(
        `No secret found for intent ${pending.intentId.slice(0, 16)}... — cannot finalize deposit`
      );
    }
    const secret = await hexToFr(secretEntry.secretHex);
    logInfo("Secret retrieved from storage");

    // =========================================================================
    // Step 1: Compute L2→L1 message hash and fetch proof
    // =========================================================================
    currentStep = 1;
    logStep(1, PHASE2_TOTAL_STEPS, "Prepare L1 execution");
    setOperationStep(1);

    // Reconstruct DepositIntent from PendingDeposit string fields
    const depositIntent: DepositIntent = {
      intentId: pending.intentId as Hex,
      ownerHash: pending.ownerHash as Hex,
      asset: pending.asset as Address,
      amount: BigInt(pending.netAmount),
      originalDecimals: pending.originalDecimals,
      deadline: BigInt(pending.deadline),
      salt: pending.salt as Hex,
      secretHash: pending.secretHash as Hex,
    };

    const l2TxBlockNumber = Number(pending.l2BlockNumber) || (await node.getBlockNumber());
    logInfo(`L2 transaction in block ${l2TxBlockNumber}, waiting for message proof...`);

    // Get rollup version from outbox
    const rollupVersion = await getOutboxVersion(publicClient, l1Addresses.aztecOutbox);
    const chainId = BigInt(await publicClient.getChainId());
    logInfo(`Rollup version: ${rollupVersion}, Chain ID: ${chainId}`);

    // Compute content hash matching L2 contract's compute_deposit_message_content
    // Field order: [intentId, ownerHash, asset, netAmount, originalDecimals, deadline, salt, secretHash]
    const contentFields = [
      BigInt(pending.intentId),
      BigInt(pending.ownerHash),
      BigInt(pending.asset),
      BigInt(pending.netAmount),
      BigInt(pending.originalDecimals),
      BigInt(pending.deadline),
      BigInt(pending.salt),
      BigInt(pending.secretHash),
    ];

    const packedData = new Uint8Array(contentFields.length * 32);
    for (let i = 0; i < contentFields.length; i++) {
      packedData.set(bigIntToBytes32(contentFields[i]), i * 32);
    }
    const contentHash = await sha256ToField(packedData);

    // Compute L2→L1 message hash
    const { Fr: FrClass } = await import("@aztec/aztec.js/fields");
    const { computeL2ToL1MessageHash } = await import("@aztec/stdlib/hash");
    const { EthAddress } = await import("@aztec/foundation/eth-address");
    const { AztecAddress: AztecAddressClass } = await import("@aztec/stdlib/aztec-address");

    const l2ToL1Message = await computeL2ToL1MessageHash({
      l2Sender: AztecAddressClass.fromString(pending.l2ContractAddress),
      l1Recipient: EthAddress.fromString(l1Addresses.portal),
      content: contentHash,
      rollupVersion: new FrClass(rollupVersion),
      chainId: new FrClass(chainId),
    });

    // Wait for L2→L1 message proof
    logSection("L2→L1", "Waiting for message to be proven on L1...");
    const proofResult: L2ToL1MessageProofResult = await waitForL2ToL1MessageProof(
      node,
      l2ToL1Message,
      l2TxBlockNumber,
      180_000,
      5000
    );

    if (!proofResult.success) {
      throw new Error(`Failed to get L2→L1 message proof: ${proofResult.error}`);
    }

    logSuccess(
      `Message proof obtained: block=${proofResult.l2BlockNumber}, leafIndex=${proofResult.leafIndex}`
    );

    // Check if message was already consumed
    const leafId = computeLeafId(proofResult.leafIndex!, proofResult.siblingPath!.length);
    const alreadyConsumedInOutbox = await hasMessageBeenConsumed(
      publicClient,
      l1Addresses.aztecOutbox,
      proofResult.l2BlockNumber!,
      leafId
    );

    if (alreadyConsumedInOutbox) {
      logInfo("Message already consumed in outbox, skipping L1 execution");
    }

    // Wait for L2 block checkpoint to be proven on L1
    logSection("L2→L1", "Waiting for L2 block proof on L1 Outbox...");
    const checkpointProven = await waitForCheckpointProven(
      publicClient,
      l1Addresses.aztecOutbox,
      proofResult.l2BlockNumber!
    );
    if (!checkpointProven) {
      throw new Error(
        `Timed out waiting for L2 block ${proofResult.l2BlockNumber} checkpoint to be proven on L1`
      );
    }
    logSuccess("Checkpoint proven on L1");

    // =========================================================================
    // Step 2: Execute deposit on L1
    // =========================================================================
    currentStep = 2;
    logStep(2, PHASE2_TOTAL_STEPS, "Execute deposit on L1");
    setOperationStep(2);

    logSection("Privacy", "Relayer executing L1 deposit (not user)");

    const proof: MerkleProof = {
      l2BlockNumber: proofResult.l2BlockNumber!,
      leafIndex: proofResult.leafIndex!,
      siblingPath: proofResult.siblingPath! as Hex[],
    };

    const executeResult = await executeDeposit(
      publicClient,
      walletClient,
      l1Addresses.portal,
      depositIntent,
      proof
    );
    txHashes.l1Execute = executeResult.txHash;
    const l1ToL2MessageIndex = executeResult.messageIndex;
    const l1MessageLeaf = executeResult.messageLeaf;
    logInfo(`L1→L2 message index: ${l1ToL2MessageIndex}`);

    // Get shares recorded for this intent
    const shares = await getIntentShares(publicClient, l1Addresses.portal, pending.intentId as Hex);
    logSuccess(`Shares recorded: ${shares.toString()}`);

    // =========================================================================
    // Step 3: Wait for L1→L2 message to be consumable
    // =========================================================================
    currentStep = 3;
    logStep(3, PHASE2_TOTAL_STEPS, "Wait for L1→L2 message");
    setOperationStep(3);

    const messageReady = await waitForL1ToL2Message(publicClient, node, l1MessageLeaf);

    // =========================================================================
    // Step 4: Call finalize_deposit on L2
    // =========================================================================
    currentStep = 4;
    logStep(4, PHASE2_TOTAL_STEPS, "Finalize deposit on L2");
    setOperationStep(4);

    const assetAsField = BigInt(pending.asset);
    const intentIdFr = await hexToFr(pending.intentId);

    if (!messageReady) {
      logSection("L2", "Cannot finalize - L1→L2 message not consumable", "warning");
      logInfo("The message may need more time to sync. Try again later.");
    } else {
      try {
        logInfo("Sending finalize_deposit transaction...");
        const finalizeResult = await executeFinalizeDeposit(
          contract,
          {
            intentId: intentIdFr,
            assetId: assetAsField,
            shares,
            secret,
            messageLeafIndex: l1ToL2MessageIndex,
          },
          wallet.address
        );
        txHashes.l2Finalize = finalizeResult.txHash;
        logSuccess(`Finalize tx: ${finalizeResult.txHash}`);
      } catch (error) {
        logSection("L2", "finalize_deposit failed", "warning");
        logInfo(error instanceof Error ? error.message : "Unknown error");
        console.error("finalize_deposit error:", error);
      }
    }

    // Remove pending deposit from localStorage after successful Phase 2
    removePendingDeposit(pending.intentId);
    logInfo("Pending deposit removed from storage");

    // Mark operation as successful
    setOperationStatus("success");
    logSuccess("Deposit Phase 2 complete!");

    return {
      intentId: pending.intentId,
      shares,
      txHashes,
    };
  } catch (error) {
    setOperationError(error instanceof Error ? error.message : "Unknown error");

    if (
      error instanceof UserRejectedError ||
      error instanceof NetworkError ||
      error instanceof TimeoutError
    ) {
      throw error;
    }

    if (isUserRejection(error)) {
      throw new UserRejectedError(currentStep, "deposit-phase2");
    }

    if (isNetworkError(error)) {
      throw new NetworkError(currentStep, "deposit-phase2", error);
    }

    if (isTimeoutError(error)) {
      throw new TimeoutError(currentStep, "deposit-phase2");
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Deposit Phase 2 failed at step ${currentStep}: ${message}`);
  } finally {
    clearOperation();
  }
}
