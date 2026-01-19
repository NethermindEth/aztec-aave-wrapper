/**
 * Cancel Deposit Flow Orchestrator
 *
 * Implements cancel_deposit flow for reclaiming tokens when deadline passes
 * without L1 execution. This allows users to recover their L2 tokens when
 * a deposit intent expires.
 *
 * CANCEL DEPOSIT FLOW:
 * 1. Validate that current time exceeds the intent deadline
 * 2. Call cancel_deposit on L2 (mints refund tokens, updates intent status)
 *
 * NOTE: Cancel is only possible for intents in PENDING_DEPOSIT status where
 * the deadline has passed without L1 execution.
 */

import type { PublicClient, Transport, Chain } from "viem";

// L2 Services
import type { AztecNodeClient } from "../services/l2/client.js";
import type { AaveWrapperContract } from "../services/l2/deploy.js";
import type { Fr } from "../services/l2/operations.js";
import { getSponsoredFeePaymentMethod } from "../services/l2/operations.js";
import type { AztecAddress } from "../services/l2/wallet.js";

// Store
import {
  setOperationError,
  setOperationIntentId,
  setOperationStatus,
  setOperationStep,
  startOperation,
  removePosition,
} from "../store/actions.js";
import { logError, logInfo, logStep, logSuccess } from "../store/logger.js";
import {
  isNetworkError,
  isTimeoutError,
  isUserRejection,
  NetworkError,
  TimeoutError,
  UserRejectedError,
} from "../types/errors.js";
import { formatUSDC } from "../types/state.js";

// Re-export shared error types for consumers importing from this module
export { NetworkError, TimeoutError, UserRejectedError } from "../types/errors.js";

// =============================================================================
// Types
// =============================================================================

/**
 * L2 context for cancel operations.
 */
export interface CancelL2Context {
  /** Aztec node client */
  node: AztecNodeClient;
  /** User wallet wrapper with address accessor */
  wallet: { address: AztecAddress };
  /** AaveWrapper contract instance */
  contract: AaveWrapperContract;
}

/**
 * Pending deposit data required to initiate cancellation
 */
export interface PendingDepositForCancel {
  /** Intent ID of the pending deposit */
  intentId: Fr;
  /** Deadline timestamp (unix seconds) when the intent expires */
  deadline: bigint;
  /** Net amount to be refunded (after any fees) */
  netAmount: bigint;
}

/**
 * Configuration for cancel deposit operation
 */
export interface CancelDepositConfig {
  /** Pending deposit to cancel */
  pendingDeposit: PendingDepositForCancel;
}

/**
 * Result of a successful cancel deposit operation
 */
export interface CancelDepositResult {
  /** Intent ID that was cancelled */
  intentId: string;
  /** Amount refunded to user */
  refundedAmount: bigint;
  /** Transaction hash */
  txHash: string;
}

/**
 * Cancel deposit flow error with step information
 */
export class CancelDepositFlowError extends Error {
  constructor(
    public readonly step: number,
    public readonly stepName: string,
    public readonly cause: unknown
  ) {
    const message = cause instanceof Error ? cause.message : "Unknown error";
    super(`Cancel deposit failed at step ${step} (${stepName}): ${message}`);
    this.name = "CancelDepositFlowError";
  }
}

/**
 * Error thrown when deadline has not yet passed
 */
export class DeadlineNotExpiredError extends Error {
  constructor(deadline: bigint, currentTime: bigint) {
    super(
      `Cannot cancel deposit: deadline has not expired. ` +
        `Deadline: ${deadline}, Current time: ${currentTime}. ` +
        `Wait ${Number(deadline - currentTime)} more seconds.`
    );
    this.name = "DeadlineNotExpiredError";
  }
}

/**
 * Error thrown when net amount validation fails
 */
export class NetAmountMismatchError extends Error {
  constructor(expected: bigint, provided: bigint) {
    super(
      `Net amount mismatch during cancel. ` +
        `Expected: ${expected}, Provided: ${provided}`
    );
    this.name = "NetAmountMismatchError";
  }
}

// =============================================================================
// Constants
// =============================================================================

/** Total number of steps in cancel deposit flow */
const CANCEL_DEPOSIT_STEPS = 2;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get current L1 timestamp for deadline validation.
 * Uses L1 block.timestamp as the authoritative time source.
 *
 * @param publicClient - L1 public client
 * @returns Current L1 timestamp as bigint
 */
async function getCurrentL1Timestamp(
  publicClient: PublicClient<Transport, Chain>
): Promise<bigint> {
  const block = await publicClient.getBlock();
  return block.timestamp;
}

/**
 * Validate that the deadline has passed.
 *
 * @param deadline - Intent deadline timestamp
 * @param currentTime - Current L1 timestamp
 * @throws DeadlineNotExpiredError if deadline has not passed
 */
function validateDeadlineExpired(deadline: bigint, currentTime: bigint): void {
  // Contract uses strict greater than: current_time > deadline
  if (currentTime <= deadline) {
    throw new DeadlineNotExpiredError(deadline, currentTime);
  }
}

// =============================================================================
// Main Cancel Deposit Flow
// =============================================================================

/**
 * Execute the cancel deposit flow.
 *
 * This function orchestrates the cancellation of a pending deposit:
 * 1. Validate that current time exceeds the intent deadline
 * 2. Call cancel_deposit on L2 (mints refund tokens, updates intent status)
 *
 * The cancel_deposit function on L2:
 * - Mints the refund tokens back to the user
 * - Verifies the caller owns the intent
 * - Verifies the deadline has passed
 * - Verifies the intent is in PENDING_DEPOSIT status
 * - Verifies the net amount matches
 * - Updates intent status to CANCELLED
 *
 * @param publicClient - L1 public client for timestamp queries
 * @param l2Context - L2 node, wallet, and contract
 * @param config - Cancel configuration including pending deposit data
 * @returns Cancel result with refunded amount
 * @throws CancelDepositFlowError if any step fails
 * @throws DeadlineNotExpiredError if deadline has not passed
 *
 * @example
 * ```ts
 * const result = await executeCancelDeposit(
 *   publicClient,
 *   { node, wallet, contract },
 *   {
 *     pendingDeposit: {
 *       intentId,
 *       deadline: 1700000000n,
 *       netAmount: 1_000_000n,
 *     },
 *   }
 * );
 * console.log(`Cancelled! Refunded: ${result.refundedAmount}`);
 * ```
 */
export async function executeCancelDeposit(
  publicClient: PublicClient<Transport, Chain>,
  l2Context: CancelL2Context,
  config: CancelDepositConfig
): Promise<CancelDepositResult> {
  const { wallet, contract } = l2Context;
  const { pendingDeposit } = config;
  const totalSteps = CANCEL_DEPOSIT_STEPS;

  // Track current step for error reporting
  let currentStep = 0;

  // Initialize operation tracking
  startOperation("deposit", totalSteps); // Use "deposit" type since we're cancelling a deposit

  try {
    // =========================================================================
    // Step 1: Validate deadline expiration
    // =========================================================================
    currentStep = 1;
    logStep(1, totalSteps, "Validate deadline expiration");
    setOperationStep(1);

    const intentIdStr = pendingDeposit.intentId.toString();
    setOperationIntentId(intentIdStr);

    logInfo(`Intent ID: ${intentIdStr.slice(0, 16)}...`);
    logInfo(`Net amount to refund: ${formatUSDC(pendingDeposit.netAmount)} USDC`);

    // Get current L1 timestamp
    const currentTime = await getCurrentL1Timestamp(publicClient);
    logInfo(`Current L1 time: ${currentTime}`);
    logInfo(`Intent deadline: ${pendingDeposit.deadline}`);

    // Validate deadline has passed
    validateDeadlineExpired(pendingDeposit.deadline, currentTime);

    const timePastDeadline = Number(currentTime - pendingDeposit.deadline);
    logSuccess(`Deadline expired ${timePastDeadline}s ago - cancellation allowed`);

    // =========================================================================
    // Step 2: Call cancel_deposit on L2
    // =========================================================================
    currentStep = 2;
    logStep(2, totalSteps, "Cancel deposit on L2");
    setOperationStep(2);

    logInfo("Calling cancel_deposit on L2 contract...");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = contract.methods as any;

    const call = methods.cancel_deposit(
      pendingDeposit.intentId,
      currentTime, // current_time as u64
      pendingDeposit.netAmount // net_amount as u128
    );

    // Get the sponsored fee payment method
    const paymentMethod = await getSponsoredFeePaymentMethod();

    // Execute the transaction
    logInfo("Sending cancel_deposit transaction...");
    const tx = await call.send({ from: wallet.address, fee: { paymentMethod } }).wait();

    const txHash = tx.txHash?.toString() ?? "";
    logSuccess(`Cancel deposit executed, tx: ${txHash}`);

    // Remove the position from the store (intent is now cancelled)
    removePosition(intentIdStr);

    // Mark operation as successful
    setOperationStatus("success");
    logSuccess("Cancel deposit flow complete!");
    logSuccess(`Refunded: ${formatUSDC(pendingDeposit.netAmount)} USDC`);

    return {
      intentId: intentIdStr,
      refundedAmount: pendingDeposit.netAmount,
      txHash,
    };
  } catch (error) {
    setOperationError(error instanceof Error ? error.message : "Unknown error");

    // Re-throw specific error types without wrapping
    if (
      error instanceof CancelDepositFlowError ||
      error instanceof DeadlineNotExpiredError ||
      error instanceof NetAmountMismatchError ||
      error instanceof UserRejectedError ||
      error instanceof NetworkError ||
      error instanceof TimeoutError
    ) {
      throw error;
    }

    // Detect and throw specific error types
    if (isUserRejection(error)) {
      throw new UserRejectedError(currentStep, "cancel_deposit");
    }

    if (isNetworkError(error)) {
      throw new NetworkError(currentStep, "cancel_deposit", error);
    }

    if (isTimeoutError(error)) {
      throw new TimeoutError(currentStep, "cancel_deposit");
    }

    // Check for specific contract errors
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes("Deadline has not expired")) {
      // Extract times if possible from error message
      throw new DeadlineNotExpiredError(pendingDeposit.deadline, 0n);
    }
    if (errorMsg.includes("Net amount mismatch")) {
      throw new NetAmountMismatchError(0n, pendingDeposit.netAmount);
    }

    // Fall through to generic cancel flow error
    throw new CancelDepositFlowError(currentStep, "cancel_deposit", error);
  }
}

/**
 * Execute cancel deposit flow with automatic retry on transient failures.
 *
 * Note: DeadlineNotExpiredError and UserRejectedError are NOT retried
 * as they represent permanent or intentional failures.
 *
 * @param publicClient - L1 public client
 * @param l2Context - L2 context
 * @param config - Cancel config
 * @param maxRetries - Maximum retry attempts (default: 3)
 * @returns Cancel result
 */
export async function executeCancelDepositWithRetry(
  publicClient: PublicClient<Transport, Chain>,
  l2Context: CancelL2Context,
  config: CancelDepositConfig,
  maxRetries = 3
): Promise<CancelDepositResult> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logInfo(`Cancel deposit attempt ${attempt}/${maxRetries}`);
      return await executeCancelDeposit(publicClient, l2Context, config);
    } catch (error) {
      // Don't retry permanent failures or user rejections
      if (
        error instanceof DeadlineNotExpiredError ||
        error instanceof NetAmountMismatchError ||
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

  throw lastError ?? new Error("Cancel deposit failed after retries");
}
