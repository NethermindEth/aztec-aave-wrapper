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
import type { AaveWrapperContract } from "./deploy.js";
import { loadAztecModules } from "./modules.js";
import type { AztecAddress } from "./wallet.js";

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

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = contract.methods as any;

    const call = methods.request_deposit(
      params.asset,
      params.amount,
      params.originalDecimals,
      params.deadline,
      params.secretHash
    );

    // Simulate first to get intent ID
    const intentId = await call.simulate({ from });

    // Execute the transaction
    const tx = await call.send({ from }).wait();

    logSuccess(`Deposit request executed, tx: ${tx.txHash?.toString()}`);

    return {
      intentId,
      txHash: tx.txHash?.toString() ?? "",
    };
  } catch (error) {
    logError(`Deposit request failed: ${error instanceof Error ? error.message : "Unknown error"}`);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = contract.methods as any;

    const call = methods.finalize_deposit(
      params.intentId,
      params.assetId,
      params.shares,
      params.secret,
      params.messageLeafIndex
    );

    const tx = await call.send({ from }).wait();

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

    // Simulate first to get intent ID
    const intentId = await call.simulate({ from });

    // Execute the transaction
    const tx = await call.send({ from }).wait();

    logSuccess(`Withdrawal request executed, tx: ${tx.txHash?.toString()}`);

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

    const tx = await call.send({ from }).wait();

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
