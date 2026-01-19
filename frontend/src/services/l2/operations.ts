/**
 * L2 Contract Interaction Service
 *
 * Implements AaveWrapper contract method calls for deposit and withdrawal operations.
 * Provides simulation and execution functions with proper error handling.
 *
 * Methods:
 * - request_deposit: Initiate a deposit intent
 * - finalize_deposit: Complete deposit after L1 execution
 * - request_withdraw: Initiate a withdrawal intent
 * - finalize_withdraw: Complete withdrawal after L1 execution
 */

import { logError, logInfo, logSuccess } from "../../store/logger.js";
import {
  bigIntToBytes32,
  computeDepositConfirmationContent,
  computeIntentId,
  computeSalt,
} from "./crypto.js";
import type { AaveWrapperContract } from "./deploy.js";
import { loadAztecModules } from "./modules.js";
import type { AztecAddress } from "./wallet.js";

// =============================================================================
// Sponsored Fee Payment
// =============================================================================

/**
 * Cached sponsored fee payment method instance.
 * We cache this to avoid re-computing on every transaction.
 */
let cachedSponsoredPaymentMethod: unknown = null;

/**
 * Get or create a sponsored fee payment method.
 * This uses the SponsoredFPC contract deployed in the sandbox
 * which pays for transaction fees without requiring Fee Juice.
 *
 * @returns SponsoredFeePaymentMethod instance
 */
export async function getSponsoredFeePaymentMethod(): Promise<unknown> {
  if (cachedSponsoredPaymentMethod) {
    return cachedSponsoredPaymentMethod;
  }

  logInfo("Setting up sponsored fee payment method...");

  try {
    // Import required modules
    const { SponsoredFPCContract } = await import("@aztec/noir-contracts.js/SponsoredFPC");
    const { getContractInstanceFromInstantiationParams } = await import("@aztec/stdlib/contract");
    const { SponsoredFeePaymentMethod } = await import("@aztec/aztec.js/fee");
    const { Fr } = await import("@aztec/aztec.js/fields");

    // Derive the SponsoredFPC instance (deployed with salt=0 in sandbox)
    const sponsoredFPCInstance = await getContractInstanceFromInstantiationParams(
      SponsoredFPCContract.artifact,
      { salt: new Fr(0) }
    );

    logInfo(`SponsoredFPC address: ${sponsoredFPCInstance.address.toString()}`);

    // Create the payment method
    cachedSponsoredPaymentMethod = new SponsoredFeePaymentMethod(sponsoredFPCInstance.address);

    logSuccess("Sponsored fee payment method ready");
    return cachedSponsoredPaymentMethod;
  } catch (error) {
    logError(
      `Failed to setup sponsored fee payment: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}

// =============================================================================
// Types
// =============================================================================

/**
 * Fr type from Aztec SDK (field element)
 */
export type Fr = InstanceType<Awaited<ReturnType<typeof loadAztecModules>>["Fr"]>;

/**
 * Parameters for request_deposit operation
 */
export interface RequestDepositParams {
  /** Asset identifier on target chain */
  asset: bigint;
  /** Amount to deposit (smallest unit) */
  amount: bigint;
  /** Original token decimals for normalization */
  originalDecimals: number;
  /** Unix timestamp after which intent expires */
  deadline: bigint;
  /** Hash of secret for L1->L2 message authentication */
  secretHash: Fr;
}

/**
 * Parameters for finalize_deposit operation
 */
export interface FinalizeDepositParams {
  /** Unique intent identifier from request_deposit */
  intentId: Fr;
  /** Asset identifier */
  assetId: bigint;
  /** Number of aToken shares received */
  shares: bigint;
  /** Secret pre-image for message authentication */
  secret: Fr;
  /** Index in L1->L2 message tree */
  messageLeafIndex: bigint;
}

/**
 * Parameters for request_withdraw operation
 */
export interface RequestWithdrawParams {
  /** Nonce of the PositionReceiptNote (same as deposit intent_id) */
  nonce: Fr;
  /** Amount of shares to withdraw */
  amount: bigint;
  /** Unix timestamp after which intent expires */
  deadline: bigint;
  /** Hash of secret for L1->L2 message authentication */
  secretHash: Fr;
}

/**
 * Parameters for finalize_withdraw operation
 */
export interface FinalizeWithdrawParams {
  /** Unique intent identifier from request_withdraw */
  intentId: Fr;
  /** Asset identifier */
  assetId: bigint;
  /** Amount that was withdrawn */
  amount: bigint;
  /** Secret pre-image for message authentication */
  secret: Fr;
  /** Index in L1->L2 message tree */
  messageLeafIndex: bigint;
}

/**
 * Result of a deposit request simulation
 */
export interface DepositSimulationResult {
  /** Generated intent ID */
  intentId: Fr;
}

/**
 * Result of a deposit request execution
 */
export interface DepositRequestResult {
  /** Generated intent ID */
  intentId: Fr;
  /** Transaction hash */
  txHash: string;
}

/**
 * Result of a withdrawal request simulation
 */
export interface WithdrawSimulationResult {
  /** Generated intent ID */
  intentId: Fr;
}

/**
 * Result of a withdrawal request execution
 */
export interface WithdrawRequestResult {
  /** Generated intent ID */
  intentId: Fr;
  /** Transaction hash */
  txHash: string;
}

/**
 * Result of a finalize operation execution
 */
export interface FinalizeResult {
  /** Transaction hash */
  txHash: string;
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error thrown when contract operation fails
 */
export class ContractOperationError extends Error {
  constructor(
    public readonly operation: string,
    public readonly cause: unknown
  ) {
    const message = cause instanceof Error ? cause.message : "Unknown contract error";
    super(`${operation} failed: ${message}`);
    this.name = "ContractOperationError";
  }
}

// =============================================================================
// Deposit Operations
// =============================================================================

/**
 * Simulate a deposit request to get the intent ID without executing.
 *
 * This matches the e2e pattern:
 * ```ts
 * const intentId = await methods.request_deposit(
 *   asset, amount, originalDecimals, deadline, secretHash
 * ).simulate({ from: userAddress });
 * ```
 *
 * @param contract - AaveWrapper contract instance
 * @param params - Deposit parameters
 * @param from - Sender address
 * @returns Simulated intent ID
 *
 * @example
 * ```ts
 * const { intentId } = await simulateRequestDeposit(contract, {
 *   asset: 1n,
 *   amount: 1_000_000n,
 *   originalDecimals: 6,
 *   deadline: BigInt(Date.now() / 1000 + 3600),
 *   secretHash,
 * }, userAddress);
 * ```
 */
export async function simulateRequestDeposit(
  contract: AaveWrapperContract,
  params: RequestDepositParams,
  from: AztecAddress
): Promise<DepositSimulationResult> {
  logInfo("Simulating deposit request...");

  try {
    // Access contract methods dynamically (generated contract types)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = contract.methods as any;

    const call = methods.request_deposit(
      params.asset,
      params.amount,
      params.originalDecimals,
      params.deadline,
      params.secretHash
    );

    const intentId = await call.simulate({ from });

    logInfo(`Simulation complete, intent ID: ${intentId.toString().slice(0, 16)}...`);

    return { intentId };
  } catch (error) {
    logError(
      `Deposit simulation failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    throw new ContractOperationError("simulateRequestDeposit", error);
  }
}

/**
 * Execute a deposit request on the L2 contract.
 *
 * This matches the e2e pattern:
 * ```ts
 * const tx = await methods.request_deposit(
 *   asset, amount, originalDecimals, deadline, secretHash
 * ).send({ from: userAddress }).wait();
 * ```
 *
 * @param contract - AaveWrapper contract instance
 * @param params - Deposit parameters
 * @param from - Sender address
 * @returns Intent ID and transaction hash
 *
 * @example
 * ```ts
 * const { intentId, txHash } = await executeRequestDeposit(contract, {
 *   asset: 1n,
 *   amount: 1_000_000n,
 *   originalDecimals: 6,
 *   deadline: BigInt(Date.now() / 1000 + 3600),
 *   secretHash,
 * }, userAddress);
 * ```
 */
export async function executeRequestDeposit(
  contract: AaveWrapperContract,
  params: RequestDepositParams,
  from: AztecAddress
): Promise<DepositRequestResult> {
  logInfo("Executing deposit request...");

  // Debug: Log parameters
  logInfo(`  asset: ${params.asset}`);
  logInfo(`  amount: ${params.amount}`);
  logInfo(`  originalDecimals: ${params.originalDecimals}`);
  logInfo(`  deadline: ${params.deadline}`);
  logInfo(`  secretHash: ${params.secretHash?.toString?.() ?? params.secretHash}`);
  logInfo(`  from: ${from?.toString?.() ?? from}`);

  try {
    // Compute the intent_id locally using the same formula as the Noir contract
    // This avoids issues with Azguard wallet's simulation/return value extraction
    logInfo("Computing intent ID locally...");
    const salt = await computeSalt(from, params.secretHash);
    const intentId = await computeIntentId({
      caller: from,
      asset: params.asset,
      amount: params.amount,
      originalDecimals: params.originalDecimals,
      deadline: params.deadline,
      salt,
    });
    logInfo(`Computed intent ID: ${intentId.toString().slice(0, 16)}...`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = contract.methods as any;

    const call = methods.request_deposit(
      params.asset,
      params.amount,
      params.originalDecimals,
      params.deadline,
      params.secretHash
    );

    // Get the sponsored fee payment method (no Fee Juice required)
    const paymentMethod = await getSponsoredFeePaymentMethod();

    // Execute the transaction with sponsored fee payment
    logInfo("Sending transaction to wallet for approval (using sponsored fees)...");
    const tx = await call.send({ from, fee: { paymentMethod } }).wait();

    logSuccess(`Deposit request executed, tx: ${tx.txHash?.toString()}`);

    return {
      intentId,
      txHash: tx.txHash?.toString() ?? "",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logError(`Deposit request failed: ${errorMessage}`);
    if (errorStack) {
      logError(`Stack trace: ${errorStack}`);
    }
    // Log the full error object for debugging
    console.error("Full deposit error:", error);
    throw new ContractOperationError("executeRequestDeposit", error);
  }
}

/**
 * Finalize a deposit by consuming the L1->L2 confirmation message.
 *
 * @param contract - AaveWrapper contract instance
 * @param params - Finalize parameters
 * @param from - Sender address
 * @returns Transaction hash
 *
 * @example
 * ```ts
 * const { txHash } = await executeFinalizeDeposit(contract, {
 *   intentId,
 *   assetId: 1n,
 *   shares: 1_000_000n,
 *   secret,
 *   messageLeafIndex: 0n,
 * }, userAddress);
 * ```
 */
export async function executeFinalizeDeposit(
  contract: AaveWrapperContract,
  params: FinalizeDepositParams,
  from: AztecAddress
): Promise<FinalizeResult> {
  logInfo("Finalizing deposit...");

  try {
    // Debug: Log all parameters for message content hash computation
    const intentIdBigInt = params.intentId.toBigInt();
    const assetIdBigInt = params.assetId;
    const sharesBigInt = params.shares;

    console.log("=== DEBUG: finalize_deposit parameters ===");
    console.log(`  intentId (bigint): ${intentIdBigInt}`);
    console.log(`  intentId (hex):    0x${intentIdBigInt.toString(16).padStart(64, "0")}`);
    console.log(`  assetId (bigint):  ${assetIdBigInt}`);
    console.log(`  assetId (hex):     0x${assetIdBigInt.toString(16).padStart(64, "0")}`);
    console.log(`  shares (bigint):   ${sharesBigInt}`);
    console.log(`  shares (hex):      0x${sharesBigInt.toString(16).padStart(64, "0")}`);
    console.log(`  secret:            ${params.secret.toString()}`);
    console.log(`  messageLeafIndex:  ${params.messageLeafIndex}`);

    // Compute expected content hash locally for comparison
    const expectedContentHash = await computeDepositConfirmationContent(
      intentIdBigInt,
      assetIdBigInt,
      sharesBigInt
    );
    console.log(`  Expected content hash: ${expectedContentHash.toString()}`);

    // Show the raw bytes being hashed (browser-compatible hex conversion)
    const intentBytes = bigIntToBytes32(intentIdBigInt);
    const assetBytes = bigIntToBytes32(assetIdBigInt);
    const sharesBytes = bigIntToBytes32(sharesBigInt);
    const bytesToHex = (bytes: Uint8Array) =>
      Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    console.log(`  intentId bytes: 0x${bytesToHex(intentBytes)}`);
    console.log(`  assetId bytes:  0x${bytesToHex(assetBytes)}`);
    console.log(`  shares bytes:   0x${bytesToHex(sharesBytes)}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = contract.methods as any;

    const call = methods.finalize_deposit(
      params.intentId,
      params.assetId,
      params.shares,
      params.secret,
      params.messageLeafIndex
    );

    // Get the sponsored fee payment method
    const paymentMethod = await getSponsoredFeePaymentMethod();
    const tx = await call.send({ from, fee: { paymentMethod } }).wait();

    logSuccess(`Deposit finalized, tx: ${tx.txHash?.toString()}`);

    return {
      txHash: tx.txHash?.toString() ?? "",
    };
  } catch (error) {
    logError(
      `Finalize deposit failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    throw new ContractOperationError("executeFinalizeDeposit", error);
  }
}

// =============================================================================
// Withdrawal Operations
// =============================================================================

/**
 * Simulate a withdrawal request to get the intent ID without executing.
 *
 * @param contract - AaveWrapper contract instance
 * @param params - Withdrawal parameters
 * @param from - Sender address
 * @returns Simulated intent ID
 *
 * @example
 * ```ts
 * const { intentId } = await simulateRequestWithdraw(contract, {
 *   nonce: depositIntentId,
 *   amount: 1_000_000n,
 *   deadline: BigInt(Date.now() / 1000 + 3600),
 *   secretHash,
 * }, userAddress);
 * ```
 */
export async function simulateRequestWithdraw(
  contract: AaveWrapperContract,
  params: RequestWithdrawParams,
  from: AztecAddress
): Promise<WithdrawSimulationResult> {
  logInfo("Simulating withdrawal request...");

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = contract.methods as any;

    const call = methods.request_withdraw(
      params.nonce,
      params.amount,
      params.deadline,
      params.secretHash
    );

    const intentId = await call.simulate({ from });

    logInfo(`Simulation complete, intent ID: ${intentId.toString().slice(0, 16)}...`);

    return { intentId };
  } catch (error) {
    logError(
      `Withdrawal simulation failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    throw new ContractOperationError("simulateRequestWithdraw", error);
  }
}

/**
 * Execute a withdrawal request on the L2 contract.
 *
 * @param contract - AaveWrapper contract instance
 * @param params - Withdrawal parameters
 * @param from - Sender address
 * @returns Intent ID and transaction hash
 *
 * @example
 * ```ts
 * const { intentId, txHash } = await executeRequestWithdraw(contract, {
 *   nonce: depositIntentId,
 *   amount: 1_000_000n,
 *   deadline: BigInt(Date.now() / 1000 + 3600),
 *   secretHash,
 * }, userAddress);
 * ```
 */
export async function executeRequestWithdraw(
  contract: AaveWrapperContract,
  params: RequestWithdrawParams,
  from: AztecAddress
): Promise<WithdrawRequestResult> {
  logInfo("Executing withdrawal request...");

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = contract.methods as any;

    const call = methods.request_withdraw(
      params.nonce,
      params.amount,
      params.deadline,
      params.secretHash
    );

    // Get the sponsored fee payment method
    const paymentMethod = await getSponsoredFeePaymentMethod();

    // Execute the transaction
    // Note: We skip simulation because Azguard wallet's simulateTx returns Fr[] which
    // requires manual decoding. Instead, we get the intent ID from transaction return values.
    const tx = await call.send({ from, fee: { paymentMethod } }).wait();

    logSuccess(`Withdrawal request executed, tx: ${tx.txHash?.toString()}`);

    // Extract intent ID from transaction return values
    let intentId = tx.returnValues?.[0];

    if (!intentId) {
      // Fallback: try to get from debugInfo or other sources
      logInfo("Return values not directly available, checking debugInfo...");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const debugInfo = (tx as any).debugInfo;
      if (debugInfo?.returnValues?.[0]) {
        intentId = debugInfo.returnValues[0];
      }
    }

    if (!intentId) {
      throw new Error("Could not extract intent ID from transaction result");
    }

    logInfo(`Withdraw intent ID from transaction: ${intentId.toString().slice(0, 16)}...`);

    return {
      intentId,
      txHash: tx.txHash?.toString() ?? "",
    };
  } catch (error) {
    logError(
      `Withdrawal request failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    throw new ContractOperationError("executeRequestWithdraw", error);
  }
}

/**
 * Finalize a withdrawal by consuming the L1->L2 confirmation message.
 *
 * @param contract - AaveWrapper contract instance
 * @param params - Finalize parameters
 * @param from - Sender address
 * @returns Transaction hash
 *
 * @example
 * ```ts
 * const { txHash } = await executeFinalizeWithdraw(contract, {
 *   intentId,
 *   assetId: 1n,
 *   amount: 1_000_000n,
 *   secret,
 *   messageLeafIndex: 0n,
 * }, userAddress);
 * ```
 */
export async function executeFinalizeWithdraw(
  contract: AaveWrapperContract,
  params: FinalizeWithdrawParams,
  from: AztecAddress
): Promise<FinalizeResult> {
  logInfo("Finalizing withdrawal...");

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = contract.methods as any;

    const call = methods.finalize_withdraw(
      params.intentId,
      params.assetId,
      params.amount,
      params.secret,
      params.messageLeafIndex
    );

    // Get the sponsored fee payment method
    const paymentMethod = await getSponsoredFeePaymentMethod();
    const tx = await call.send({ from, fee: { paymentMethod } }).wait();

    logSuccess(`Withdrawal finalized, tx: ${tx.txHash?.toString()}`);

    return {
      txHash: tx.txHash?.toString() ?? "",
    };
  } catch (error) {
    logError(
      `Finalize withdrawal failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    throw new ContractOperationError("executeFinalizeWithdraw", error);
  }
}

// =============================================================================
// Transaction Polling
// =============================================================================

/**
 * Configuration for transaction polling
 */
export interface TransactionPollingConfig {
  /** Maximum time to wait in milliseconds (default: 120000 = 2 min) */
  timeout?: number;
  /** Interval between polls in milliseconds (default: 1000 = 1 sec) */
  interval?: number;
}

/**
 * Transaction status result
 */
export interface TransactionStatus {
  /** Whether the transaction has been confirmed */
  confirmed: boolean;
  /** Transaction hash */
  txHash: string;
  /** Block number if confirmed */
  blockNumber?: bigint;
  /** Error message if failed */
  error?: string;
}

/**
 * Wait for an L2 transaction to be confirmed by polling status.
 *
 * Use this when the wallet doesn't immediately report transaction status.
 * The function polls the PXE for transaction receipt until confirmed or timeout.
 *
 * @param pxe - PXE client instance (from wallet.getPXE())
 * @param txHash - Transaction hash to poll for
 * @param config - Polling configuration
 * @returns Transaction status
 *
 * @example
 * ```ts
 * const status = await waitForTransaction(pxe, txHash, {
 *   timeout: 60000,
 *   interval: 2000,
 * });
 * if (status.confirmed) {
 *   console.log(`Confirmed in block ${status.blockNumber}`);
 * }
 * ```
 */
export async function waitForTransaction(
  pxe: { getTxReceipt: (hash: unknown) => Promise<{ status: string; blockNumber?: bigint }> },
  txHash: string,
  config: TransactionPollingConfig = {}
): Promise<TransactionStatus> {
  const { timeout = 120000, interval = 1000 } = config;

  const startTime = Date.now();

  logInfo(`Polling for transaction ${txHash.slice(0, 16)}...`);

  while (Date.now() - startTime < timeout) {
    try {
      // Pass txHash directly - PXE implementations accept string or TxHash
      const receipt = await pxe.getTxReceipt(txHash);

      // Check for confirmed status (success or mined)
      if (receipt.status === "success" || receipt.status === "mined") {
        logSuccess(`Transaction confirmed in block ${receipt.blockNumber}`);
        return {
          confirmed: true,
          txHash,
          blockNumber: receipt.blockNumber,
        };
      }

      // Check for failed status
      if (receipt.status === "dropped" || receipt.status === "failed") {
        logError(`Transaction failed with status: ${receipt.status}`);
        return {
          confirmed: false,
          txHash,
          error: `Transaction ${receipt.status}`,
        };
      }

      // Still pending, wait and retry
      await new Promise((resolve) => setTimeout(resolve, interval));
    } catch {
      // Receipt not found yet, continue polling
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  // Timeout reached
  logError(`Transaction polling timed out after ${timeout}ms`);
  return {
    confirmed: false,
    txHash,
    error: `Polling timed out after ${timeout}ms`,
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a random secret and compute its hash for authentication.
 *
 * @returns Secret and its hash
 *
 * @example
 * ```ts
 * const { secret, secretHash } = await generateSecretPair();
 * ```
 */
export async function generateSecretPair(): Promise<{
  secret: Fr;
  secretHash: Fr;
}> {
  const { Fr, computeSecretHash } = await loadAztecModules();

  const secret = Fr.random();
  const secretHash = await computeSecretHash(secret);

  return { secret, secretHash };
}

/**
 * Compute the deadline timestamp from an offset.
 *
 * @param offsetSeconds - Seconds from now until deadline
 * @returns Deadline as bigint timestamp
 *
 * @example
 * ```ts
 * const deadline = deadlineFromNow(3600); // 1 hour from now
 * ```
 */
export function deadlineFromNow(offsetSeconds: number): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + offsetSeconds);
}

// =============================================================================
// Cancel Deposit Operation
// =============================================================================

/**
 * Parameters for cancel_deposit operation
 */
export interface CancelDepositParams {
  /** The unique intent identifier of the deposit to cancel */
  intentId: Fr;
  /** Current timestamp for deadline validation (must be > deadline for cancel to succeed) */
  currentTime: bigint;
  /** The net deposit amount to be refunded (must match stored value) */
  netAmount: bigint;
}

/**
 * Result of a cancel deposit execution
 */
export interface CancelDepositResult {
  /** Transaction hash */
  txHash: string;
}

/**
 * Execute a cancel deposit operation on the L2 contract.
 *
 * This function cancels a pending deposit after the deadline has passed,
 * refunding the net_amount to the user. The caller must own the intent.
 *
 * Note: The current_time parameter should be accurate - if it's too far in the past,
 * the transaction will fail. Using Date.now() / 1000 is recommended.
 *
 * @param contract - AaveWrapper contract instance
 * @param params - Cancel deposit parameters
 * @param from - Sender address (must be the intent owner)
 * @returns Transaction hash
 *
 * @example
 * ```ts
 * const { txHash } = await executeCancelDeposit(contract, {
 *   intentId,
 *   currentTime: BigInt(Math.floor(Date.now() / 1000)),
 *   netAmount: 999_000n, // net amount after fee deduction
 * }, userAddress);
 * ```
 */
export async function executeCancelDeposit(
  contract: AaveWrapperContract,
  params: CancelDepositParams,
  from: AztecAddress
): Promise<CancelDepositResult> {
  logInfo("Executing cancel deposit...");

  // Debug: Log parameters
  logInfo(`  intentId: ${params.intentId?.toString?.() ?? params.intentId}`);
  logInfo(`  currentTime: ${params.currentTime}`);
  logInfo(`  netAmount: ${params.netAmount}`);
  logInfo(`  from: ${from?.toString?.() ?? from}`);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = contract.methods as any;

    const call = methods.cancel_deposit(params.intentId, params.currentTime, params.netAmount);

    // Get the sponsored fee payment method (no Fee Juice required)
    const paymentMethod = await getSponsoredFeePaymentMethod();

    // Execute the transaction with sponsored fee payment
    logInfo("Sending cancel deposit transaction to wallet for approval (using sponsored fees)...");
    const tx = await call.send({ from, fee: { paymentMethod } }).wait();

    logSuccess(`Cancel deposit executed, tx: ${tx.txHash?.toString()}`);

    return {
      txHash: tx.txHash?.toString() ?? "",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logError(`Cancel deposit failed: ${errorMessage}`);
    if (errorStack) {
      logError(`Stack trace: ${errorStack}`);
    }
    // Log the full error object for debugging
    console.error("Full cancel deposit error:", error);
    throw new ContractOperationError("executeCancelDeposit", error);
  }
}
