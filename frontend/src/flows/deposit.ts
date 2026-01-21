/**
 * Deposit Flow Orchestrator
 *
 * Implements complete deposit flow for privacy-preserving Aave deposits.
 * Coordinates L2 → L1 → L2 operations with step tracking and logging.
 *
 * PRIVACY-PRESERVING DEPOSIT FLOW:
 * 1. Generate secret and prepare parameters
 * 2. Call request_deposit on L2 - burns user's L2 tokens via BridgedToken
 * 3. Wait for L2→L1 message to be available
 * 4. Execute deposit on L1 - relayer claims from TokenPortal and supplies to Aave
 * 5. Wait for L1→L2 message
 * 6. Call finalize_deposit on L2 - creates encrypted PositionReceiptNote
 *
 * The burn-based flow ensures privacy: user's L2 tokens are burned during request,
 * then the L1 portal claims equivalent tokens from TokenPortal. This breaks the
 * direct link between the user's L1 wallet and the Aave deposit.
 */

import {
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  pad,
  type Transport,
  toHex,
} from "viem";
// L1 Services
import type { L1Clients } from "../services/l1/client.js";
import type { DepositIntent } from "../services/l1/intent.js";
import { mineL1Block } from "../services/l1/mining.js";
import { executeDeposit, getIntentShares, type MerkleProof } from "../services/l1/portal.js";
import { balanceOf, type L1AddressesForBalances } from "../services/l1/tokens.js";
// L2 Services
import type { AztecNodeClient } from "../services/l2/client.js";
import {
  bigIntToBytes32,
  computeOwnerHash,
  generateSecretPair,
  sha256ToField,
} from "../services/l2/crypto.js";
import type { AaveWrapperContract } from "../services/l2/deploy.js";
import {
  computeLeafId,
  getOutboxVersion,
  hasMessageBeenConsumed,
  type L2ToL1MessageProofResult,
  waitForL2ToL1MessageProof,
} from "../services/l2/messageProof.js";
import {
  executeFinalizeDeposit,
  executeRequestDeposit,
  type Fr,
} from "../services/l2/operations.js";
import type { AztecAddress } from "../services/l2/wallet.js";
import { storeSecret } from "../services/secrets.js";
import {
  clearOperation,
  setOperationError,
  setOperationIntentId,
  setOperationStatus,
  setOperationStep,
  startOperation,
} from "../store/actions.js";
// Store
import { logError, logInfo, logSection, logStep, logSuccess } from "../store/logger.js";
import {
  isNetworkError,
  isTimeoutError,
  isUserRejection,
  NetworkError,
  TimeoutError,
  UserRejectedError,
} from "../types/errors.js";
import { getDepositStepCount } from "../types/operations.js";
import { formatUSDC } from "../types/state.js";

// Re-export shared error types for consumers importing from this module
export { NetworkError, TimeoutError, UserRejectedError } from "../types/errors.js";

// =============================================================================
// Types
// =============================================================================

/**
 * L1 contract addresses required for deposit flow
 */
export interface DepositL1Addresses extends L1AddressesForBalances {
  /** Real Aztec outbox for L2→L1 message verification */
  aztecOutbox: Address;
}

/**
 * L2 context for deposit operations.
 * Note: AzguardWallet doesn't expose address directly - callers must
 * construct this wrapper using wallet.getAccounts() (see useFlowClients).
 */
export interface DepositL2Context {
  /** Aztec node client */
  node: AztecNodeClient;
  /** User wallet wrapper with address accessor */
  wallet: { address: AztecAddress };
  /** AaveWrapper contract instance */
  contract: AaveWrapperContract;
}

/**
 * Configuration for deposit operation
 */
export interface DepositConfig {
  /** Amount to deposit (in token's smallest unit) */
  amount: bigint;
  /** Token decimals */
  originalDecimals: number;
  /** Deadline offset in seconds from current L1 timestamp */
  deadlineOffset: number;
}

/**
 * Result of a successful deposit operation
 */
export interface DepositResult {
  /** Generated intent ID */
  intentId: string;
  /** Secret used for finalization (store securely) */
  secret: Fr;
  /** Hash of the secret */
  secretHash: Fr;
  /** Number of aToken shares received */
  shares: bigint;
  /** Transaction hashes for each step */
  txHashes: {
    l2Request?: string;
    l1Execute?: string;
    l2Finalize?: string;
  };
}

/**
 * Deposit flow error with step information
 */
export class DepositFlowError extends Error {
  constructor(
    public readonly step: number,
    public readonly stepName: string,
    public readonly cause: unknown
  ) {
    const message = cause instanceof Error ? cause.message : "Unknown error";
    super(`Deposit failed at step ${step} (${stepName}): ${message}`);
    this.name = "DepositFlowError";
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Wait for L1→L2 message to be consumable by polling for membership witness.
 * This is the definitive check - if we can get a witness, the message is consumable.
 *
 * @returns true if message is ready, false if timeout
 */
async function waitForL1ToL2Message(
  publicClient: PublicClient<Transport, Chain>,
  node: AztecNodeClient,
  messageLeaf: Hex,
  maxWaitMs = 300_000, // 5 minutes - increased to allow L2 blocks to advance
  pollIntervalMs = 5000 // 5 seconds between polls
): Promise<boolean> {
  console.log("[waitForL1ToL2Message] ENTERED FUNCTION");
  console.log("[waitForL1ToL2Message] messageLeaf:", messageLeaf);
  console.log("[waitForL1ToL2Message] maxWaitMs:", maxWaitMs);

  const startTime = Date.now();
  const { Fr } = await import("@aztec/aztec.js/fields");

  // Convert hex message leaf to Fr for querying
  const messageLeafFr = Fr.fromString(messageLeaf);
  console.log("[waitForL1ToL2Message] messageLeafFr:", messageLeafFr.toString());

  let pollCount = 0;
  let lastBlockMined = Date.now();
  const minMineInterval = 10000; // Mine L1 every 10s to trigger archiver sync faster

  console.log("[waitForL1ToL2Message] Starting poll loop...");

  while (Date.now() - startTime < maxWaitMs) {
    pollCount++;
    console.log(`[waitForL1ToL2Message] Poll ${pollCount} starting...`);

    try {
      console.log("[waitForL1ToL2Message] Getting current block number...");
      const currentBlock = await node.getBlockNumber();
      console.log("[waitForL1ToL2Message] currentBlock:", currentBlock);

      // Step 1: Check which block the message will be available
      console.log("[waitForL1ToL2Message] Calling getL1ToL2MessageBlock...");
      const messageBlockNumber = await node.getL1ToL2MessageBlock(messageLeafFr);
      console.log("[waitForL1ToL2Message] messageBlockNumber:", messageBlockNumber);

      if (messageBlockNumber === undefined) {
        logInfo(
          `Poll ${pollCount}: Message not yet indexed by archiver (L2 block=${currentBlock})`
        );
      } else if (currentBlock < messageBlockNumber) {
        logInfo(
          `Poll ${pollCount}: Message available at block ${messageBlockNumber}, current=${currentBlock}`
        );
      } else {
        // Message should be available - try to get the membership witness
        // This is the DEFINITIVE check - if we get a witness, it's consumable
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const nodeAny = node as any;

        console.log(
          `[L1→L2] Poll ${pollCount}: currentBlock=${currentBlock} >= messageBlock=${messageBlockNumber}`
        );
        console.log(`[L1→L2] Attempting to get membership witness...`);

        if (typeof nodeAny.getL1ToL2MembershipWitness === "function") {
          try {
            console.log(
              `[L1→L2] Calling getL1ToL2MembershipWitness(${currentBlock}, ${messageLeafFr.toString()})`
            );
            const witness = await nodeAny.getL1ToL2MembershipWitness(currentBlock, messageLeafFr);
            console.log(`[L1→L2] Witness response:`, witness);

            if (witness && witness.length > 0) {
              const elapsed = Math.round((Date.now() - startTime) / 1000);
              console.log(
                `[L1→L2] ✓ Witness obtained! Index: ${witness[0]}, siblingPath length: ${witness[1]?.length || 0}`
              );
              logSuccess(
                `L1→L2 message is consumable! (${elapsed}s, witness obtained at block ${currentBlock})`
              );
              return true;
            }
            console.log(`[L1→L2] Witness returned but empty or invalid`);
            logInfo(
              `Poll ${pollCount}: Block ${currentBlock} >= ${messageBlockNumber} but witness not yet available`
            );
          } catch (witnessError) {
            console.log(`[L1→L2] Witness query error:`, witnessError);
            logInfo(
              `Poll ${pollCount}: Witness query failed: ${witnessError instanceof Error ? witnessError.message : "error"}`
            );
          }
        } else {
          // Fallback: if no witness API, trust block number check
          console.log(
            `[L1→L2] getL1ToL2MembershipWitness not available on node, falling back to block check`
          );
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
// Main Deposit Flow
// =============================================================================

/**
 * Execute the complete deposit flow.
 *
 * This function orchestrates all 6 steps of the deposit process:
 * 1. Generate secret and prepare parameters
 * 2. Call request_deposit on L2
 * 3. Wait for L2→L1 message
 * 4. Execute deposit on L1 (fund portal + execute)
 * 5. Wait for L1→L2 message
 * 6. Call finalize_deposit on L2
 *
 * @param l1Clients - L1 public and wallet clients
 * @param l1Addresses - L1 contract addresses
 * @param l2Context - L2 node, wallet, and contract
 * @param config - Deposit configuration
 * @returns Deposit result with intent ID and shares
 * @throws DepositFlowError if any step fails
 *
 * @example
 * ```ts
 * const result = await executeDepositFlow(
 *   l1Clients,
 *   l1Addresses,
 *   { node, wallet, contract },
 *   { assetId: 1n, amount: 1_000_000n, originalDecimals: 6, deadlineOffset: 3600 }
 * );
 * console.log(`Deposited! Intent: ${result.intentId}, Shares: ${result.shares}`);
 * ```
 */
export async function executeDepositFlow(
  l1Clients: L1Clients,
  l1Addresses: DepositL1Addresses,
  l2Context: DepositL2Context,
  config: DepositConfig
): Promise<DepositResult> {
  const { publicClient, userWallet, relayerWallet } = l1Clients;
  const { node, wallet, contract } = l2Context;
  const totalSteps = getDepositStepCount();
  const txHashes: DepositResult["txHashes"] = {};

  // Track current step for error reporting
  let currentStep = 0;

  // Initialize operation tracking
  startOperation("deposit", totalSteps);

  // Debug: Log loaded addresses at flow start to catch stale config issues
  console.log("=== DEPOSIT FLOW: LOADED ADDRESSES ===");
  console.log("  mockUsdc:", l1Addresses.mockUsdc);
  console.log("  portal:", l1Addresses.portal);
  console.log("  aztecOutbox:", l1Addresses.aztecOutbox);
  console.log("  L2 contract:", contract.address.toString());
  console.log("=======================================");

  try {
    // =========================================================================
    // Step 1: Generate secret and prepare parameters
    // =========================================================================
    currentStep = 1;
    logStep(1, totalSteps, "Generate secret and prepare parameters");
    setOperationStep(1);

    const { secret, secretHash } = await generateSecretPair();

    // Get L1 block timestamp to compute deadline
    const l1Block = await publicClient.getBlock();
    const l1Timestamp = Number(l1Block.timestamp);
    const deadline = BigInt(l1Timestamp + config.deadlineOffset);

    logInfo(`Deadline: ${deadline} (L1 timestamp + ${config.deadlineOffset}s)`);
    logInfo(`Amount: ${formatUSDC(config.amount)} USDC`);

    // Compute owner hash for privacy
    const ownerHashFr = await computeOwnerHash(wallet.address);
    const ownerHash = ownerHashFr.toBigInt();

    logSection("Privacy", `Owner hash computed: ${ownerHash.toString(16).slice(0, 16)}...`);

    // =========================================================================
    // Step 2: Call request_deposit on L2
    // =========================================================================
    currentStep = 2;
    logStep(2, totalSteps, "Call request_deposit on L2");
    setOperationStep(2);

    // Use the L1 token address as the asset parameter (converted to bigint/Field)
    // This must match what the L2 content hash computation expects
    const assetAsField = BigInt(l1Addresses.mockUsdc);

    const depositResult = await executeRequestDeposit(
      contract,
      {
        asset: assetAsField,
        amount: config.amount,
        originalDecimals: config.originalDecimals,
        deadline,
        secretHash,
      },
      wallet.address
    );

    const intentId = depositResult.intentId;
    const intentIdStr = intentId.toString();
    txHashes.l2Request = depositResult.txHash;

    setOperationIntentId(intentIdStr);
    logSuccess(`Intent ID: ${intentIdStr.slice(0, 16)}...`);
    logSuccess(`L2 tx: ${depositResult.txHash}`);

    // CRITICAL: Store secret immediately after request_deposit succeeds
    // This ensures we can retry finalize_deposit if it fails later
    const l2AddressHex = wallet.address.toString();
    await storeSecret(intentIdStr, secret.toString(), l2AddressHex);
    logInfo("Secret stored for recovery");

    // =========================================================================
    // Step 3: Prepare L1 execution (message proof will be fetched in step 4)
    // =========================================================================
    currentStep = 3;
    logStep(3, totalSteps, "Prepare L1 execution");
    setOperationStep(3);

    logInfo("L2 request complete, preparing L1 execution...");

    // =========================================================================
    // Step 4: Execute deposit on L1 (wait for proof + execute)
    // =========================================================================
    currentStep = 4;
    logStep(4, totalSteps, "Execute deposit on L1");
    setOperationStep(4);

    const userL1Address = userWallet.account.address;

    // Check user's USDC balance
    const userBalance = await balanceOf(publicClient, l1Addresses.mockUsdc, userL1Address);
    logInfo(`User USDC balance: ${formatUSDC(userBalance)}`);

    if (userBalance < config.amount) {
      throw new Error(
        `Insufficient USDC balance: ${formatUSDC(userBalance)} < ${formatUSDC(config.amount)}`
      );
    }

    // NOTE: No direct L1 approve/transfer from user's wallet here
    // Tokens flow through TokenPortal: user's L2 tokens were already burned in request_deposit,
    // and the L1 portal claims from TokenPortal during executeDeposit.
    // This preserves privacy - no direct link between user's L1 wallet and the deposit.

    // Import Aztec modules for computing L2→L1 message hash
    const { Fr } = await import("@aztec/aztec.js/fields");
    const { computeL2ToL1MessageHash } = await import("@aztec/stdlib/hash");
    const { EthAddress } = await import("@aztec/foundation/eth-address");
    const { AztecAddress } = await import("@aztec/stdlib/aztec-address");
    const { poseidon2Hash } = await import("@aztec/foundation/crypto/poseidon");

    // Compute values exactly as the L2 contract does:
    // 1. salt = poseidon2_hash([caller.to_field(), secret_hash])
    // 2. fee = amount * 10 / 10000 (0.1% fee)
    // 3. net_amount = amount - fee
    const callerField = wallet.address.toBigInt();
    const l2Salt = await poseidon2Hash([new Fr(callerField), secretHash]);
    const fee = (config.amount * 10n) / 10000n;
    const netAmount = config.amount - fee;

    console.log("=== L2 Contract Values (must match) ===");
    console.log("  caller:", `0x${callerField.toString(16)}`);
    console.log("  secretHash:", secretHash.toString());
    console.log("  computed salt:", l2Salt.toString());
    console.log("  fee:", fee.toString());
    console.log("  net_amount:", netAmount.toString());

    // Create deposit intent for L1 with the correct computed values
    const intentIdHex = pad(toHex(BigInt(intentIdStr)), { size: 32 }) as Hex;
    const ownerHashHex = pad(toHex(ownerHash), { size: 32 }) as Hex;
    const secretHashHex = pad(toHex(secretHash.toBigInt()), { size: 32 }) as Hex;
    const saltHex = pad(toHex(l2Salt.toBigInt()), { size: 32 }) as Hex;

    const depositIntent: DepositIntent = {
      intentId: intentIdHex,
      ownerHash: ownerHashHex,
      asset: l1Addresses.mockUsdc,
      amount: netAmount, // Use NET amount (after fee deduction)
      originalDecimals: config.originalDecimals,
      deadline,
      salt: saltHex,
      secretHash: secretHashHex,
    };

    console.log("=== DEBUG: Deposit Intent Values ===");
    console.log("intentId:", depositIntent.intentId);
    console.log("ownerHash:", depositIntent.ownerHash);
    console.log("asset:", depositIntent.asset);
    console.log("amount:", depositIntent.amount.toString());
    console.log("originalDecimals:", depositIntent.originalDecimals);
    console.log("deadline:", depositIntent.deadline.toString());
    console.log("salt:", depositIntent.salt);

    // Get L2 block number from the request_deposit transaction
    const l2TxBlockNumber = depositResult.blockNumber ?? (await node.getBlockNumber());
    logInfo(`L2 transaction in block ${l2TxBlockNumber}, waiting for message proof...`);

    // Get rollup version from outbox
    const rollupVersion = await getOutboxVersion(publicClient, l1Addresses.aztecOutbox);
    const chainId = BigInt(await publicClient.getChainId());
    logInfo(`Rollup version: ${rollupVersion}, Chain ID: ${chainId}`);

    // Compute the content hash matching the L2 contract's compute_deposit_message_content
    // This must match exactly what the Noir contract sends via message_portal:
    // sha256_to_field([intent_id, owner_hash, asset, net_amount, original_decimals, deadline, salt, secret_hash])
    // Each field is encoded as 32 bytes (big-endian), total 256 bytes
    // IMPORTANT: intent.asset is the L1 token address as a Field (BigInt), NOT an asset ID!
    const contentFields = [
      BigInt(intentIdStr), // intent.intent_id
      ownerHash, // intent.owner_hash
      BigInt(l1Addresses.mockUsdc), // intent.asset (L1 token address as Field)
      netAmount, // intent.amount (NET amount after fee!)
      BigInt(config.originalDecimals), // intent.original_decimals
      deadline, // intent.deadline
      l2Salt.toBigInt(), // intent.salt (computed same as L2)
      secretHash.toBigInt(), // secret_hash
    ];
    console.log(
      "Content fields for L2→L1 message:",
      contentFields.map((f) => `0x${f.toString(16)}`)
    );

    // Pack fields into bytes (each field as 32-byte big-endian) and compute sha256
    const packedData = new Uint8Array(contentFields.length * 32);
    for (let i = 0; i < contentFields.length; i++) {
      packedData.set(bigIntToBytes32(contentFields[i]), i * 32);
    }
    console.log("=== SHA256 DEBUG ===");
    console.log("Packed data length:", packedData.length, "bytes (expected 256)");
    console.log(
      "Packed data (hex):",
      "0x" +
        Array.from(packedData)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
    );

    // Compute sha256 and convert to field (truncate to 31 bytes/248 bits to fit in BN254 field)
    const contentHash = await sha256ToField(packedData);
    console.log("SHA256 to Field (truncated to 31 bytes):", contentHash.toString());

    console.log("=== DEBUG: Deposit Flow ===");
    console.log("Content hash:", contentHash.toString());
    console.log("Outbox address:", l1Addresses.aztecOutbox);
    console.log("Portal address:", l1Addresses.portal);

    // Compute the full L2→L1 message hash
    const l2ToL1Message = await computeL2ToL1MessageHash({
      l2Sender: AztecAddress.fromString(contract.address.toString()),
      l1Recipient: EthAddress.fromString(l1Addresses.portal),
      content: contentHash,
      rollupVersion: new Fr(rollupVersion),
      chainId: new Fr(chainId),
    });

    console.log("L2→L1 message hash:", l2ToL1Message.toString());

    // Wait for the L2→L1 message proof from the real outbox
    logSection("L2→L1", "Waiting for message to be proven on L1...");
    const proofResult: L2ToL1MessageProofResult = await waitForL2ToL1MessageProof(
      node,
      l2ToL1Message,
      l2TxBlockNumber,
      180_000, // 3 minutes max wait
      5000 // 5 second polling
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

    // Execute deposit via relayer
    logSection("Privacy", "Relayer executing L1 deposit (not user)");

    const proof: MerkleProof = {
      l2BlockNumber: proofResult.l2BlockNumber!,
      leafIndex: proofResult.leafIndex!,
      siblingPath: proofResult.siblingPath! as `0x${string}`[],
    };

    // Check if intent was already consumed (from a previous failed attempt)
    const alreadyConsumed = await publicClient.readContract({
      address: l1Addresses.portal,
      abi: [
        {
          name: "consumedDepositIntents",
          type: "function",
          stateMutability: "view",
          inputs: [{ type: "bytes32" }],
          outputs: [{ type: "bool" }],
        },
      ] as const,
      functionName: "consumedDepositIntents",
      args: [depositIntent.intentId],
    });
    console.log("Intent already consumed?", alreadyConsumed);
    console.log("Executing with proof:", {
      l2BlockNumber: proof.l2BlockNumber.toString(),
      leafIndex: proof.leafIndex.toString(),
    });

    const executeResult = await executeDeposit(
      publicClient,
      relayerWallet,
      l1Addresses.portal,
      depositIntent,
      proof
    );
    txHashes.l1Execute = executeResult.txHash;
    const l1ToL2MessageIndex = executeResult.messageIndex;
    const l1MessageLeaf = executeResult.messageLeaf;
    logInfo(`L1→L2 message index: ${l1ToL2MessageIndex}`);
    console.log("L1→L2 message leaf (L1 computed):", l1MessageLeaf);

    // Get shares recorded for this intent
    console.log("[DEBUG] Fetching shares for intent...");
    const shares = await getIntentShares(publicClient, l1Addresses.portal, intentIdHex);
    console.log("[DEBUG] Shares fetched:", shares.toString());
    logSuccess(`Shares recorded: ${shares.toString()}`);

    // =========================================================================
    // Step 5: Wait for L1→L2 message to be consumable
    // =========================================================================
    currentStep = 5;
    logStep(5, totalSteps, "Wait for L1→L2 message");
    setOperationStep(5);

    console.log("[L1→L2] Starting to wait for message to be consumable...");
    console.log("[L1→L2] Message leaf:", l1MessageLeaf);

    // Wait for L1→L2 message to be consumable (polls membership witness - no signing)
    const messageReady = await waitForL1ToL2Message(publicClient, node, l1MessageLeaf);

    // =========================================================================
    // Step 6: Call finalize_deposit on L2
    // =========================================================================
    currentStep = 6;
    logStep(6, totalSteps, "Finalize deposit on L2");
    setOperationStep(6);

    // Use actual shares from L1 (fetched above) - must match message content hash
    // assetAsField was already computed earlier (L1 token address as BigInt)

    console.log("=== DEBUG: Values for finalize_deposit ===");
    console.log(`  intentId: ${intentId.toString()}`);
    console.log(`  shares: ${shares}`);
    console.log(`  assetAsField: ${assetAsField}`);
    console.log(`  assetAsField (hex): 0x${assetAsField.toString(16)}`);
    console.log(`  l1ToL2MessageIndex: ${l1ToL2MessageIndex}`);
    console.log(`  secret: ${secret.toString()}`);
    console.log(`  L2 contract address: ${contract.address.toString()}`);
    console.log(`  Portal address: ${l1Addresses.portal}`);

    // CRITICAL: Log whether we will attempt finalize_deposit
    console.log("=== FINALIZE DECISION ===");
    console.log(`  messageReady: ${messageReady}`);
    if (!messageReady) {
      console.log("  ACTION: SKIPPING finalize_deposit - message not consumable yet");
      logSection("L2", "Cannot finalize - L1→L2 message not consumable", "warning");
    } else {
      console.log("  ACTION: PROCEEDING with finalize_deposit");
    }

    if (!messageReady) {
      logInfo("The message may need more time to sync. Try again later.");
    } else {
      // Message is confirmed consumable - send finalize_deposit (ONE signature)
      try {
        logInfo("Sending finalize_deposit transaction...");
        const finalizeResult = await executeFinalizeDeposit(
          contract,
          {
            intentId,
            assetId: assetAsField,
            shares: shares,
            secret,
            messageLeafIndex: l1ToL2MessageIndex,
          },
          wallet.address
        );
        txHashes.l2Finalize = finalizeResult.txHash;
        console.log("=== FINALIZE_DEPOSIT SUCCESS ===");
        console.log(`  txHash: ${finalizeResult.txHash}`);
        console.log("  Position receipt note should now exist on L2");
        logSuccess(`Finalize tx: ${finalizeResult.txHash}`);
      } catch (error) {
        logSection("L2", "finalize_deposit failed", "warning");
        logInfo(error instanceof Error ? error.message : "Unknown error");
        console.error("finalize_deposit error:", error);
      }
    }

    // Note: Position is added by caller (App.tsx) after flow completes

    // Mark operation as successful
    setOperationStatus("success");
    logSuccess("Deposit flow complete!");

    return {
      intentId: intentIdStr,
      secret,
      secretHash,
      shares,
      txHashes,
    };
  } catch (error) {
    setOperationError(error instanceof Error ? error.message : "Unknown error");

    // Re-throw specific error types without wrapping
    if (
      error instanceof DepositFlowError ||
      error instanceof UserRejectedError ||
      error instanceof NetworkError ||
      error instanceof TimeoutError
    ) {
      throw error;
    }

    // Detect and throw specific error types
    if (isUserRejection(error)) {
      throw new UserRejectedError(currentStep, "deposit");
    }

    if (isNetworkError(error)) {
      throw new NetworkError(currentStep, "deposit", error);
    }

    if (isTimeoutError(error)) {
      throw new TimeoutError(currentStep, "deposit");
    }

    // Fall through to generic deposit flow error
    throw new DepositFlowError(currentStep, "deposit", error);
  } finally {
    // Always reset operation state to idle when flow completes (success or error)
    clearOperation();
  }
}

/**
 * Execute deposit flow with automatic retry on transient failures.
 *
 * @param l1Clients - L1 clients
 * @param l1Addresses - L1 addresses
 * @param l2Context - L2 context
 * @param config - Deposit config
 * @param maxRetries - Maximum retry attempts (default: 3)
 * @returns Deposit result
 */
export async function executeDepositFlowWithRetry(
  l1Clients: L1Clients,
  l1Addresses: DepositL1Addresses,
  l2Context: DepositL2Context,
  config: DepositConfig,
  maxRetries = 3
): Promise<DepositResult> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logInfo(`Deposit attempt ${attempt}/${maxRetries}`);
      return await executeDepositFlow(l1Clients, l1Addresses, l2Context, config);
    } catch (error) {
      // Don't retry user rejections - these are intentional
      if (error instanceof UserRejectedError) {
        throw error;
      }

      lastError = error instanceof Error ? error : new Error(String(error));
      logError(`Attempt ${attempt} failed: ${lastError.message}`);

      if (attempt < maxRetries) {
        const delay = Math.min(1000 * 2 ** (attempt - 1), 10000);
        logInfo(`Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError ?? new Error("Deposit failed after retries");
}
