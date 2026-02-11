/**
 * Deposit Phase 1: L2 Request
 *
 * Extracts steps 1-2 from executeDepositFlow into a standalone function.
 * Covers: secret generation, L1 timestamp fetch, request_deposit on L2,
 * owner hash computation, secret storage, and pending deposit persistence.
 *
 * After Phase 1 completes, the user can safely close the browser.
 * Phase 2 (L1 execution + L2 finalization) can be resumed later
 * from the persisted PendingDeposit.
 */

import { type Chain, type PublicClient, pad, type Transport, toHex } from "viem";
// L2 services
import { computeOwnerHash, computeSalt, generateSecretPair } from "../services/l2/crypto.js";
import { executeRequestDeposit, type Fr } from "../services/l2/operations.js";
// Persistence services
import { type PendingDeposit, savePendingDeposit } from "../services/pendingDeposits.js";
import { storeSecret } from "../services/secrets.js";
// Store actions
import {
  clearOperation,
  setOperationError,
  setOperationIntentId,
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
import { formatUSDC } from "../types/state.js";
// Flow types (shared with deposit.ts)
import type { DepositConfig, DepositL1Addresses, DepositL2Context } from "./deposit.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Result of a successful Phase 1 (L2 request_deposit).
 *
 * Contains the PendingDeposit for persistence and the secret/secretHash
 * needed if the caller wants to proceed immediately to Phase 2.
 */
export interface DepositPhase1Result {
  /** Persisted pending deposit with all fields needed for Phase 2 */
  pendingDeposit: PendingDeposit;
  /** Secret (Fr) for immediate Phase 2 continuation */
  secret: Fr;
  /** Secret hash (Fr) for immediate Phase 2 continuation */
  secretHash: Fr;
}

// =============================================================================
// Phase 1 Total Steps
// =============================================================================

/** Phase 1 has 2 steps: generate secret + request_deposit on L2 */
const PHASE1_TOTAL_STEPS = 2;

// =============================================================================
// Phase 1 Flow
// =============================================================================

/**
 * Execute deposit Phase 1: L2 request.
 *
 * 1. Generate secret pair and compute deadline from L1 timestamp
 * 2. Call request_deposit on L2 (burns user's L2 tokens)
 *    - Compute owner hash and salt for privacy
 *    - Store secret for recovery
 *    - Persist PendingDeposit for Phase 2 resumption
 *
 * @param publicClient - L1 public client (for timestamp fetch)
 * @param l1Addresses - L1 contract addresses
 * @param l2Context - L2 node, wallet, and contract
 * @param config - Deposit amount, decimals, deadline offset
 * @returns Phase 1 result with PendingDeposit and secret pair
 *
 * @throws {UserRejectedError} If user rejects the L2 transaction
 * @throws {NetworkError} If network/RPC call fails
 * @throws {TimeoutError} If operation times out
 * @throws {Error} For other unexpected failures
 */
export async function executeDepositPhase1(
  publicClient: PublicClient<Transport, Chain>,
  l1Addresses: DepositL1Addresses,
  l2Context: DepositL2Context,
  config: DepositConfig
): Promise<DepositPhase1Result> {
  const { wallet, contract } = l2Context;
  let currentStep = 0;

  startOperation("deposit", PHASE1_TOTAL_STEPS);

  try {
    // =========================================================================
    // Step 1: Generate secret and prepare parameters
    // =========================================================================
    currentStep = 1;
    logStep(1, PHASE1_TOTAL_STEPS, "Generate secret and prepare parameters");
    setOperationStep(1);

    const { secret, secretHash } = await generateSecretPair();

    // Get L1 block timestamp to compute deadline
    const l1Block = await publicClient.getBlock();
    const l1Timestamp = Number(l1Block.timestamp);
    const deadline = BigInt(l1Timestamp + config.deadlineOffset);

    logInfo(`Deadline: ${deadline} (L1 timestamp + ${config.deadlineOffset}s)`);
    logInfo(`Amount: ${formatUSDC(config.amount)} USDC`);

    // =========================================================================
    // Step 2: Call request_deposit on L2
    // =========================================================================
    currentStep = 2;
    logStep(2, PHASE1_TOTAL_STEPS, "Call request_deposit on L2");
    setOperationStep(2);

    // Use the L1 token address as the asset parameter (converted to bigint/Field)
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

    setOperationIntentId(intentIdStr);
    logSuccess(`Intent ID: ${intentIdStr.slice(0, 16)}...`);
    logSuccess(`L2 tx: ${depositResult.txHash}`);

    // Compute owner hash for privacy (AFTER getting intent_id)
    // owner_hash = poseidon2_hash([caller, intent_id]) for per-intent unlinkability
    const ownerHashFr = await computeOwnerHash(wallet.address, BigInt(intentIdStr));
    logSection(
      "Privacy",
      `Owner hash computed: ${ownerHashFr.toBigInt().toString(16).slice(0, 16)}...`
    );

    // Compute salt: poseidon2_hash([caller, secret_hash])
    const saltFr = await computeSalt(wallet.address, secretHash);

    // Compute fee matching L2 contract: fee = amount * 10 / 10000 (0.1%)
    const fee = (config.amount * 10n) / 10000n;
    const netAmount = config.amount - fee;

    // CRITICAL: Store secret immediately after request_deposit succeeds
    // This ensures we can finalize_deposit if the browser is closed
    const l2AddressHex = wallet.address.toString();
    await storeSecret(intentIdStr, secret.toString(), l2AddressHex);
    logInfo("Secret stored for recovery");

    // Persist pending deposit for Phase 2 resumption
    const pendingDeposit: PendingDeposit = {
      intentId: pad(toHex(BigInt(intentIdStr)), { size: 32 }),
      ownerHash: pad(toHex(ownerHashFr.toBigInt()), { size: 32 }),
      asset: l1Addresses.mockUsdc,
      amount: config.amount.toString(),
      netAmount: netAmount.toString(),
      originalDecimals: config.originalDecimals,
      deadline: deadline.toString(),
      salt: pad(toHex(saltFr.toBigInt()), { size: 32 }),
      secretHash: pad(toHex(secretHash.toBigInt()), { size: 32 }),
      l2BlockNumber: (depositResult.blockNumber ?? 0).toString(),
      l2ContractAddress: contract.address.toString(),
      l2TxHash: depositResult.txHash,
      createdAt: Date.now(),
    };

    savePendingDeposit(pendingDeposit);
    logSuccess("Pending deposit saved for Phase 2");

    return {
      pendingDeposit,
      secret,
      secretHash,
    };
  } catch (error) {
    setOperationError(error instanceof Error ? error.message : "Unknown error");

    // Re-throw specific error types without wrapping
    if (
      error instanceof UserRejectedError ||
      error instanceof NetworkError ||
      error instanceof TimeoutError
    ) {
      throw error;
    }

    // Detect and throw specific error types
    if (isUserRejection(error)) {
      throw new UserRejectedError(currentStep, "deposit-phase1");
    }

    if (isNetworkError(error)) {
      throw new NetworkError(currentStep, "deposit-phase1", error);
    }

    if (isTimeoutError(error)) {
      throw new TimeoutError(currentStep, "deposit-phase1");
    }

    // Fall through to generic error
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Deposit Phase 1 failed at step ${currentStep}: ${message}`);
  } finally {
    clearOperation();
  }
}
