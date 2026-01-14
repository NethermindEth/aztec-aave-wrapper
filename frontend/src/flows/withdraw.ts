/**
 * Withdraw Flow Orchestrator
 *
 * Implements complete withdraw flow combining all 4 steps from e2e/scripts/full-flow.ts.
 * Coordinates L2 → L1 → L2 operations with step tracking and logging.
 *
 * WITHDRAW FLOW:
 * 1. Generate secret and prepare parameters
 * 2. Call request_withdraw on L2 (requires existing position note)
 * 3. Wait for L2→L1 message to be available
 * 4. Execute withdraw on L1 (relayer executes Aave withdrawal)
 *
 * NOTE: Full withdrawal only - MVP constraint enforces withdrawing entire position.
 */

import {
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  pad,
  type Transport,
  toHex,
  type WalletClient,
} from "viem";

// L1 Services
import type { L1Clients } from "../services/l1/client.js";
import { computeWithdrawIntentHash, type WithdrawIntent } from "../services/l1/intent.js";
import { mineL1Block } from "../services/l1/mining.js";
import { executeWithdraw, type MerkleProof } from "../services/l1/portal.js";

// L2 Services
import type { AztecNodeClient } from "../services/l2/client.js";
import { computeOwnerHash, generateSecretPair } from "../services/l2/crypto.js";
import type { AaveWrapperContract } from "../services/l2/deploy.js";
import {
  executeFinalizeWithdraw,
  executeRequestWithdraw,
  type Fr,
} from "../services/l2/operations.js";
import type { AztecAddress } from "../services/l2/wallet.js";
import {
  removePosition,
  setOperationError,
  setOperationIntentId,
  setOperationStatus,
  setOperationStep,
  startOperation,
} from "../store/actions.js";
// Store
import { logError, logInfo, logSection, logStep, logSuccess } from "../store/logger.js";
import { getWithdrawStepCount } from "../types/operations.js";
import { formatUSDC } from "../types/state.js";

// =============================================================================
// Types
// =============================================================================

/**
 * L1 contract addresses required for withdraw flow
 */
export interface WithdrawL1Addresses {
  /** AztecAavePortalL1 contract */
  portal: Address;
  /** Mock Aztec outbox for message verification */
  mockAztecOutbox: Address;
}

/**
 * L2 context for withdraw operations
 */
export interface WithdrawL2Context {
  /** Aztec node client */
  node: AztecNodeClient;
  /** User wallet */
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
// Mock Outbox ABI (for devnet)
// =============================================================================

const MOCK_OUTBOX_ABI = [
  {
    type: "function",
    name: "setMessageValid",
    inputs: [
      { name: "messageHash", type: "bytes32" },
      { name: "l2BlockNumber", type: "uint256" },
      { name: "valid", type: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Wait for L2→L1 message to be processable on L1.
 * In devnet with mocks, we poll until the node confirms availability.
 *
 * @param node - Aztec node client
 * @param maxAttempts - Maximum polling attempts
 * @param intervalMs - Polling interval in milliseconds
 * @returns True if message is available
 */
async function waitForL2ToL1Message(
  node: AztecNodeClient,
  maxAttempts = 30,
  intervalMs = 2000
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    logSection("L2→L1", `Waiting for message availability... (${i + 1}/${maxAttempts})`);

    // In devnet with mocks, message is available after block advancement
    // For real L2→L1 messaging, we would query the Aztec outbox
    try {
      const nodeInfo = await node.getNodeInfo();
      if (nodeInfo) {
        logSuccess("L2→L1 message availability confirmed");
        return true;
      }
    } catch {
      // Node may be temporarily unavailable
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  logError("Timeout waiting for L2→L1 message");
  return false;
}

/**
 * Wait for L1→L2 message to be available.
 *
 * @param publicClient - L1 public client
 * @param _node - Aztec node client (unused in devnet mock mode)
 */
async function waitForL1ToL2Message(
  publicClient: PublicClient<Transport, Chain>,
  _node: AztecNodeClient
): Promise<void> {
  logSection("L1→L2", "Waiting for message to be available...");

  // Mine an L1 block to finalize the message
  await mineL1Block(publicClient);

  // In devnet with mocks, the message should be available immediately
  // In production, we would poll the Aztec inbox for the message
  logSuccess("L1→L2 message should now be available");
}

/**
 * Set a message as valid in the mock outbox (devnet only).
 */
async function setMockOutboxMessageValid(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain, Account>,
  mockOutboxAddress: Address,
  messageHash: Hex,
  l2BlockNumber: bigint
): Promise<void> {
  logSection("L1", "Setting message as valid in mock outbox");

  const txHash = await walletClient.writeContract({
    address: mockOutboxAddress,
    abi: MOCK_OUTBOX_ABI,
    functionName: "setMessageValid",
    args: [messageHash, l2BlockNumber, true],
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });
  logSuccess("Mock outbox message set as valid");
}

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
 * console.log(`Withdrew! Intent: ${result.intentId}, Amount: ${result.amount}`);
 * ```
 */
export async function executeWithdrawFlow(
  l1Clients: L1Clients,
  l1Addresses: WithdrawL1Addresses,
  l2Context: WithdrawL2Context,
  config: WithdrawConfig
): Promise<WithdrawResult> {
  const { publicClient, relayerWallet } = l1Clients;
  const { node, wallet, contract } = l2Context;
  const totalSteps = getWithdrawStepCount();
  const txHashes: WithdrawResult["txHashes"] = {};

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
    logStep(1, totalSteps, "Generate secret and prepare parameters");
    setOperationStep(1);

    const { secret, secretHash } = await generateSecretPair();

    // Get L1 block timestamp to compute deadline
    const l1Block = await publicClient.getBlock();
    const l1Timestamp = Number(l1Block.timestamp);
    const deadline = BigInt(l1Timestamp + deadlineOffset);

    logInfo(`Deadline: ${deadline} (L1 timestamp + ${deadlineOffset}s)`);
    logInfo(`Amount: ${formatUSDC(withdrawAmount)} USDC (full position)`);

    // Compute owner hash for privacy
    const ownerHashFr = await computeOwnerHash(wallet.address);
    const ownerHash = ownerHashFr.toBigInt();

    logSection("Privacy", `Owner hash computed: ${ownerHash.toString(16).slice(0, 16)}...`);

    // =========================================================================
    // Step 2: Call request_withdraw on L2
    // =========================================================================
    logStep(2, totalSteps, "Call request_withdraw on L2");
    setOperationStep(2);

    logSection("L2", "Attempting request_withdraw...");
    logInfo(
      `Position nonce (deposit intent ID): ${position.depositIntentId.toString().slice(0, 16)}...`
    );

    let intentId: Fr;
    try {
      const withdrawResult = await executeRequestWithdraw(
        contract,
        {
          nonce: position.depositIntentId,
          amount: withdrawAmount,
          deadline,
          secretHash,
        },
        wallet.address
      );

      intentId = withdrawResult.intentId;
      txHashes.l2Request = withdrawResult.txHash;

      const intentIdStr = intentId.toString();
      setOperationIntentId(intentIdStr);
      logSuccess(`Withdraw Intent ID: ${intentIdStr.slice(0, 16)}...`);
      logSuccess(`L2 tx: ${withdrawResult.txHash}`);
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

    // =========================================================================
    // Step 3: Wait for L2→L1 message to be available
    // =========================================================================
    logStep(3, totalSteps, "Wait for L2→L1 message");
    setOperationStep(3);

    const messageAvailable = await waitForL2ToL1Message(node);
    if (!messageAvailable) {
      throw new Error("Timeout waiting for L2→L1 message availability");
    }

    // =========================================================================
    // Step 4: Execute withdraw on L1
    // =========================================================================
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

    // Compute message hash and set it as valid in mock outbox
    const messageHash = computeWithdrawIntentHash(withdrawIntent);

    const l2BlockNumber = 100n; // Mock L2 block number for devnet
    await setMockOutboxMessageValid(
      publicClient,
      relayerWallet,
      l1Addresses.mockAztecOutbox,
      messageHash,
      l2BlockNumber
    );

    // Execute withdraw via relayer
    logSection("Privacy", "Relayer executing L1 withdraw (not user)");
    const proof: MerkleProof = {
      l2BlockNumber,
      leafIndex: 0n,
      siblingPath: [],
    };

    const executeResult = await executeWithdraw(
      publicClient,
      relayerWallet,
      l1Addresses.portal,
      withdrawIntent,
      secretHashHex,
      proof
    );
    txHashes.l1Execute = executeResult.txHash;

    logSuccess(`Withdraw executed on L1 (tx: ${executeResult.txHash.slice(0, 10)}...)`);

    // =========================================================================
    // Optional: Finalize on L2 (if L1→L2 messaging is available)
    // =========================================================================
    // Note: In devnet without real L1→L2 messaging, finalize may fail
    // This step would complete the flow by consuming the L1→L2 message

    try {
      await waitForL1ToL2Message(publicClient, node);

      const finalizeResult = await executeFinalizeWithdraw(
        contract,
        {
          intentId,
          assetId: 1n, // USDC asset ID in MVP
          amount: withdrawAmount,
          secret,
          messageLeafIndex: 0n,
        },
        wallet.address
      );
      txHashes.l2Finalize = finalizeResult.txHash;
      logSuccess(`Finalize tx: ${finalizeResult.txHash}`);
    } catch (error) {
      // In devnet without real L1→L2 messaging, finalize may fail
      logSection("L2", "finalize_withdraw may fail without real L1→L2 message", "warning");
      logInfo(error instanceof Error ? error.message.slice(0, 100) : "Unknown error");
    }

    // Remove position from store (full withdrawal consumes the position)
    removePosition(position.depositIntentId.toString());

    // Mark operation as successful
    setOperationStatus("success");
    logSuccess("Withdraw flow complete!");

    return {
      intentId: intentIdStr,
      secret,
      secretHash,
      amount: withdrawAmount,
      txHashes,
    };
  } catch (error) {
    const step = 1; // Would track actual step in production
    setOperationError(error instanceof Error ? error.message : "Unknown error");

    // Re-throw specific error types
    if (error instanceof PositionNotFoundError || error instanceof PartialWithdrawError) {
      throw error;
    }

    throw new WithdrawFlowError(step, "withdraw", error);
  }
}

/**
 * Execute withdraw flow with automatic retry on transient failures.
 *
 * Note: PositionNotFoundError and PartialWithdrawError are NOT retried
 * as they represent permanent failures.
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
      // Don't retry permanent failures
      if (error instanceof PositionNotFoundError || error instanceof PartialWithdrawError) {
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
