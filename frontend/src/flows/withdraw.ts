/**
 * Withdraw Flow Orchestrator
 *
 * Implements complete withdraw flow for privacy-preserving Aave withdrawals.
 * Coordinates L2 → L1 → L2 operations with step tracking and logging.
 *
 * PRIVACY-PRESERVING WITHDRAW FLOW:
 * 1. Generate secret and prepare parameters
 * 2. Call request_withdraw on L2 - nullifies PositionReceiptNote
 * 3. Wait for L2→L1 message to be available
 * 4. Execute withdraw on L1 - relayer withdraws from Aave and deposits to TokenPortal
 * 5. Finalize on L2 - user can later claim tokens from TokenPortal using their secret
 *
 * The TokenPortal claim step enables privacy: L1 portal deposits withdrawn tokens
 * into TokenPortal (not directly to user), then user claims privately on L2.
 *
 * NOTE: Full withdrawal only - MVP constraint enforces withdrawing entire position.
 */

import { type Address, type Hex, pad, toHex } from "viem";

// L1 Services
import type { L1Clients } from "../services/l1/client.js";
import type { WithdrawIntent } from "../services/l1/intent.js";
import { executeWithdraw, type MerkleProof } from "../services/l1/portal.js";

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
  waitForCheckpointProven,
  waitForL2ToL1MessageProof,
} from "../services/l2/messageProof.js";
import { executeRequestWithdraw, type Fr } from "../services/l2/operations.js";
import type { AztecAddress } from "../services/l2/wallet.js";
import { storeWithdrawSecret } from "../services/secrets.js";
import {
  clearOperation,
  removePosition,
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
import { getWithdrawStepCount } from "../types/operations.js";
import { formatUSDC } from "../types/state.js";

// Re-export shared error types for consumers importing from this module
export { NetworkError, TimeoutError, UserRejectedError } from "../types/errors.js";

// =============================================================================
// Types
// =============================================================================

/**
 * L1 contract addresses required for withdraw flow
 */
export interface WithdrawL1Addresses {
  /** AztecAavePortalL1 contract */
  portal: Address;
  /** Real Aztec outbox for L2→L1 message verification */
  aztecOutbox: Address;
  /** Mock USDC token address (L1 asset address) */
  mockUsdc: Address;
}

/**
 * L2 context for withdraw operations.
 * Note: AzguardWallet doesn't expose address directly - callers must
 * construct this wrapper using wallet.getAccounts() (see useFlowClients).
 */
export interface WithdrawL2Context {
  /** Aztec node client */
  node: AztecNodeClient;
  /** User wallet wrapper with address accessor */
  wallet: { address: AztecAddress };
  /** AaveWrapper contract instance */
  contract: AaveWrapperContract;
}

/**
 * Position data required to initiate a withdrawal
 */
export interface PositionForWithdraw {
  /** Intent ID from the original deposit (used as nonce for position note) */
  depositIntentId: Fr;
  /** Number of shares/aTokens in the position */
  shares: bigint;
  /** Secret from the original deposit (for finalization, if needed) */
  depositSecret?: Fr;
}

/**
 * Configuration for withdraw operation
 */
export interface WithdrawConfig {
  /** Position to withdraw from */
  position: PositionForWithdraw;
  /** Deadline offset in seconds from current L1 timestamp */
  deadlineOffset: number;
}

/**
 * Result of a successful withdraw operation
 */
export interface WithdrawResult {
  /** Generated withdraw intent ID */
  intentId: string;
  /** Secret used for finalization */
  secret: Fr;
  /** Hash of the secret */
  secretHash: Fr;
  /** Amount withdrawn */
  amount: bigint;
  /** Transaction hashes for each step */
  txHashes: {
    l2Request?: string;
    l1Execute?: string;
    l2Finalize?: string;
  };
}

/**
 * Withdraw flow error with step information
 */
export class WithdrawFlowError extends Error {
  constructor(
    public readonly step: number,
    public readonly stepName: string,
    public readonly cause: unknown
  ) {
    const message = cause instanceof Error ? cause.message : "Unknown error";
    super(`Withdraw failed at step ${step} (${stepName}): ${message}`);
    this.name = "WithdrawFlowError";
  }
}

/**
 * Error thrown when no position is found for withdrawal
 */
export class PositionNotFoundError extends Error {
  constructor(intentId: string) {
    super(`No position found for intent ID: ${intentId}`);
    this.name = "PositionNotFoundError";
  }
}

/**
 * Error thrown when attempting partial withdrawal (not allowed in MVP)
 */
export class PartialWithdrawError extends Error {
  constructor(requested: bigint, available: bigint) {
    super(
      `Partial withdrawals not supported. Requested: ${requested}, Available: ${available}. ` +
        `Full withdrawal required - use the entire position amount.`
    );
    this.name = "PartialWithdrawError";
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Validate that withdrawal amount matches position (full withdrawal only).
 *
 * @param requestedAmount - Amount being requested for withdrawal
 * @param positionShares - Shares available in the position
 * @throws PartialWithdrawError if amounts don't match
 */
function validateFullWithdrawal(requestedAmount: bigint, positionShares: bigint): void {
  if (requestedAmount !== positionShares) {
    throw new PartialWithdrawError(requestedAmount, positionShares);
  }
}

// =============================================================================
// Main Withdraw Flow
// =============================================================================

/**
 * Execute the complete withdraw flow.
 *
 * This function orchestrates all 4 steps of the withdrawal process:
 * 1. Generate secret and prepare parameters
 * 2. Call request_withdraw on L2 (consumes position note)
 * 3. Wait for L2→L1 message
 * 4. Execute withdraw on L1 (relayer withdraws from Aave)
 *
 * NOTE: Full withdrawal only - the entire position must be withdrawn.
 * Partial withdrawals are not supported in the MVP.
 *
 * @param l1Clients - L1 public and wallet clients
 * @param l1Addresses - L1 contract addresses
 * @param l2Context - L2 node, wallet, and contract
 * @param config - Withdraw configuration including position data
 * @returns Withdraw result with intent ID and amount
 * @throws WithdrawFlowError if any step fails
 * @throws PositionNotFoundError if position doesn't exist
 * @throws PartialWithdrawError if attempting partial withdrawal
 *
 * @example
 * ```ts
 * const result = await executeWithdrawFlow(
 *   l1Clients,
 *   l1Addresses,
 *   { node, wallet, contract },
 *   {
 *     position: { depositIntentId, shares: 1_000_000n },
 *     deadlineOffset: 3600,
 *   }
 * );
 * ```
 */
export async function executeWithdrawFlow(
  l1Clients: L1Clients,
  l1Addresses: WithdrawL1Addresses,
  l2Context: WithdrawL2Context,
  config: WithdrawConfig
): Promise<WithdrawResult> {
  const { publicClient, walletClient } = l1Clients;
  const { node, wallet, contract } = l2Context;
  const totalSteps = getWithdrawStepCount();
  const txHashes: WithdrawResult["txHashes"] = {};

  // Track current step for error reporting
  let currentStep = 0;

  // Extract position data
  const { position, deadlineOffset } = config;
  const withdrawAmount = position.shares; // Full withdrawal only

  // Validate full withdrawal constraint
  validateFullWithdrawal(withdrawAmount, position.shares);

  // Initialize operation tracking
  startOperation("withdraw", totalSteps);

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
    const deadline = BigInt(l1Timestamp + deadlineOffset);

    logInfo(`Deadline: ${deadline} (L1 timestamp + ${deadlineOffset}s)`);
    logInfo(`Amount: ${formatUSDC(withdrawAmount)} USDC (full position)`);

    // NOTE: Owner hash is computed AFTER getting intent_id from L2 (see step 2)
    // because owner_hash = poseidon2_hash([owner, intent_id]) for per-intent privacy

    // Check if withdrawal was already executed on L1 (from a previous attempt)
    // This prevents wasting the L2 request_withdraw call if L1 already processed it
    const depositIntentIdHex = pad(toHex(position.depositIntentId.toBigInt()), { size: 32 }) as Hex;
    const alreadyConsumed = await publicClient.readContract({
      address: l1Addresses.portal,
      abi: [
        {
          name: "consumedWithdrawIntents",
          type: "function",
          stateMutability: "view",
          inputs: [{ type: "bytes32" }],
          outputs: [{ type: "bool" }],
        },
      ] as const,
      functionName: "consumedWithdrawIntents",
      args: [depositIntentIdHex],
    });

    if (alreadyConsumed) {
      logInfo("Withdrawal already executed on L1, cleaning up stale position...");
      // The L1 withdrawal succeeded in a previous session but L2 state is stale
      // Remove the position from local state
      removePosition(position.depositIntentId.toString());
      logSuccess("Position removed - withdrawal was already completed on L1");
      return {
        intentId: position.depositIntentId.toString(),
        secret,
        secretHash,
        amount: withdrawAmount,
        txHashes: {},
      };
    }

    // =========================================================================
    // Step 2: Call request_withdraw on L2
    // =========================================================================
    currentStep = 2;
    logStep(2, totalSteps, "Call request_withdraw on L2");
    setOperationStep(2);

    logSection("L2", "Attempting request_withdraw...");
    logInfo(
      `Position nonce (deposit intent ID): ${position.depositIntentId.toString().slice(0, 16)}...`
    );

    let intentId: Fr;
    let l2RequestBlockNumber: number | undefined;
    try {
      const withdrawResultLocal = await executeRequestWithdraw(
        contract,
        {
          nonce: position.depositIntentId,
          amount: withdrawAmount,
          deadline,
          secretHash,
        },
        wallet.address
      );

      intentId = withdrawResultLocal.intentId;
      txHashes.l2Request = withdrawResultLocal.txHash;
      l2RequestBlockNumber = withdrawResultLocal.blockNumber;

      const intentIdStr = intentId.toString();
      setOperationIntentId(intentIdStr);
      logSuccess(`Withdraw Intent ID: ${intentIdStr.slice(0, 16)}...`);
      logSuccess(`L2 tx: ${withdrawResultLocal.txHash}`);
    } catch (error) {
      // Check if this is a position-not-found error
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (
        errorMsg.includes("position") ||
        errorMsg.includes("note") ||
        errorMsg.includes("not found")
      ) {
        throw new PositionNotFoundError(position.depositIntentId.toString());
      }
      throw error;
    }

    const intentIdStr = intentId.toString();

    // Compute owner hash for privacy (AFTER getting intent_id)
    // owner_hash = poseidon2_hash([owner, intent_id]) for per-intent unlinkability
    const ownerHashFr = await computeOwnerHash(wallet.address, BigInt(intentIdStr));
    const ownerHash = ownerHashFr.toBigInt();
    logSection("Privacy", `Owner hash computed: ${ownerHash.toString(16).slice(0, 16)}...`);

    // =========================================================================
    // Step 3: Prepare L1 execution (message proof will be fetched in step 4)
    // =========================================================================
    currentStep = 3;
    logStep(3, totalSteps, "Prepare L1 execution");
    setOperationStep(3);

    logInfo("L2 request complete, preparing L1 execution...");

    // =========================================================================
    // Step 4: Execute withdraw on L1 (wait for proof + execute)
    // =========================================================================
    currentStep = 4;
    logStep(4, totalSteps, "Execute withdraw on L1");
    setOperationStep(4);

    // Create withdraw intent for L1
    const intentIdHex = pad(toHex(BigInt(intentIdStr)), { size: 32 }) as Hex;
    const ownerHashHex = pad(toHex(ownerHash), { size: 32 }) as Hex;
    const secretHashHex = pad(toHex(secretHash.toBigInt()), { size: 32 }) as Hex;

    const withdrawIntent: WithdrawIntent = {
      intentId: intentIdHex,
      ownerHash: ownerHashHex,
      amount: withdrawAmount,
      deadline,
    };

    // Get L2 block number from the request_withdraw transaction
    const l2TxBlockNumber = l2RequestBlockNumber ?? (await node.getBlockNumber());
    logInfo(`L2 transaction in block ${l2TxBlockNumber}, waiting for message proof...`);

    // Compute the L2→L1 message Fr for proof lookup
    const { Fr } = await import("@aztec/aztec.js/fields");
    const { computeL2ToL1MessageHash } = await import("@aztec/stdlib/hash");
    const { EthAddress } = await import("@aztec/foundation/eth-address");
    const { AztecAddress } = await import("@aztec/stdlib/aztec-address");

    // Get rollup version from outbox
    const rollupVersion = await getOutboxVersion(publicClient, l1Addresses.aztecOutbox);
    const chainId = BigInt(await publicClient.getChainId());
    logInfo(`Rollup version: ${rollupVersion}, Chain ID: ${chainId}`);

    // Compute the content hash matching the L2 contract's compute_withdraw_message_content:
    // sha256_to_field([intent.intent_id, intent.owner_hash, intent.amount, intent.deadline, asset_id, secret_hash])
    // Each field is encoded as 32 bytes (big-endian), total 192 bytes
    // asset_id is the L1 token address as Field (matches receipt.asset_id stored during deposit)
    const assetId = BigInt(l1Addresses.mockUsdc);
    const contentFields = [
      BigInt(intentIdStr), // intent.intent_id
      ownerHash, // intent.owner_hash
      withdrawAmount, // intent.amount
      deadline, // intent.deadline
      assetId, // receipt.asset_id (L1 token address as Field)
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
    console.log(
      "Packed data (hex):",
      "0x" +
        Array.from(packedData)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
    );

    // Compute sha256 and convert to field (truncate to 31 bytes/248 bits to fit in BN254 field)
    const contentHash = await sha256ToField(packedData);

    // Compute the full L2→L1 message hash
    const l2ToL1Message = await computeL2ToL1MessageHash({
      l2Sender: AztecAddress.fromString(contract.address.toString()),
      l1Recipient: EthAddress.fromString(l1Addresses.portal),
      content: contentHash,
      rollupVersion: new Fr(rollupVersion),
      chainId: new Fr(chainId),
    });

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

    // Wait for L2 block to be proven
    logSection("L2→L1", "Waiting for L2 block to be proven...");
    const checkpointProven = await waitForCheckpointProven(node, proofResult.l2BlockNumber!);
    if (!checkpointProven) {
      throw new Error(`Timed out waiting for L2 block ${proofResult.l2BlockNumber} to be proven`);
    }
    logSuccess("Block proven");

    // Execute withdraw via relayer
    logSection("Privacy", "Relayer executing L1 withdraw (not user)");

    const proof: MerkleProof = {
      l2BlockNumber: proofResult.l2BlockNumber!,
      leafIndex: proofResult.leafIndex!,
      siblingPath: proofResult.siblingPath! as `0x${string}`[],
    };

    const executeResult = await executeWithdraw(
      publicClient,
      walletClient,
      l1Addresses.portal,
      withdrawIntent,
      secretHashHex,
      proof
    );
    txHashes.l1Execute = executeResult.txHash;
    const actualWithdrawnAmount = executeResult.withdrawnAmount;

    const messageKey = executeResult.messageKey;

    const _l1ToL2MessageIndex = executeResult.messageIndex;
    const _l1MessageLeaf = executeResult.messageLeaf;

    logSuccess(`Withdraw executed on L1 (tx: ${executeResult.txHash.slice(0, 10)}...)`);

    // Store secret for later token claim - use messageKey as the key (not intentId)
    // because the pending bridges scanner matches secrets by messageKey
    try {
      await storeWithdrawSecret(messageKey, secret.toString(), wallet.address.toString());
      logSuccess(
        `Withdrawal secret stored for token claim (messageKey: ${messageKey.slice(0, 18)}...)`
      );
    } catch (storeError) {
      // Log but don't fail the flow - user can still try to claim if they have the secret
      logError(
        `Failed to store withdrawal secret: ${storeError instanceof Error ? storeError.message : "Unknown error"}`
      );
    }

    // =========================================================================
    // Withdrawal L1 execution complete
    // =========================================================================
    // Token claiming via BridgedToken (claim_private) completes the withdrawal.
    // The PendingWithdraw note remains on L2 for refund capability if needed.
    // Position will be filtered out from UI once tokens are claimed.

    logInfo("L1 withdrawal complete. Claim tokens via 'Pending Bridge Claims' to finish.");

    // Note: We do NOT remove the position here. It stays as PendingWithdraw until
    // either tokens are claimed (success) or refund is claimed (deadline expired).
    // The UI will filter out PendingWithdraw positions once tokens are claimed.

    // Mark operation as successful
    setOperationStatus("success");
    logSuccess("Withdraw flow complete!");

    return {
      intentId: intentIdStr,
      secret,
      secretHash,
      amount: actualWithdrawnAmount, // Actual amount withdrawn from Aave (may include interest)
      txHashes,
    };
  } catch (error) {
    setOperationError(error instanceof Error ? error.message : "Unknown error");

    // Re-throw specific error types without wrapping
    if (
      error instanceof WithdrawFlowError ||
      error instanceof PositionNotFoundError ||
      error instanceof PartialWithdrawError ||
      error instanceof UserRejectedError ||
      error instanceof NetworkError ||
      error instanceof TimeoutError
    ) {
      throw error;
    }

    // Detect and throw specific error types
    if (isUserRejection(error)) {
      throw new UserRejectedError(currentStep, "withdraw");
    }

    if (isNetworkError(error)) {
      throw new NetworkError(currentStep, "withdraw", error);
    }

    if (isTimeoutError(error)) {
      throw new TimeoutError(currentStep, "withdraw");
    }

    // Fall through to generic withdraw flow error
    throw new WithdrawFlowError(currentStep, "withdraw", error);
  } finally {
    // Always reset operation state to idle when flow completes (success or error)
    clearOperation();
  }
}

/**
 * Execute withdraw flow with automatic retry on transient failures.
 *
 * Note: PositionNotFoundError, PartialWithdrawError, and UserRejectedError
 * are NOT retried as they represent permanent or intentional failures.
 *
 * @param l1Clients - L1 clients
 * @param l1Addresses - L1 addresses
 * @param l2Context - L2 context
 * @param config - Withdraw config
 * @param maxRetries - Maximum retry attempts (default: 3)
 * @returns Withdraw result
 */
export async function executeWithdrawFlowWithRetry(
  l1Clients: L1Clients,
  l1Addresses: WithdrawL1Addresses,
  l2Context: WithdrawL2Context,
  config: WithdrawConfig,
  maxRetries = 3
): Promise<WithdrawResult> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logInfo(`Withdraw attempt ${attempt}/${maxRetries}`);
      return await executeWithdrawFlow(l1Clients, l1Addresses, l2Context, config);
    } catch (error) {
      // Don't retry permanent failures or user rejections
      if (
        error instanceof PositionNotFoundError ||
        error instanceof PartialWithdrawError ||
        error instanceof UserRejectedError
      ) {
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

  throw lastError ?? new Error("Withdraw failed after retries");
}
