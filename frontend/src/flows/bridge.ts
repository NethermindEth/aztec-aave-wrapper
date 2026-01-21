/**
 * Bridge Flow Orchestrator
 *
 * Implements the L1 portion of the bridge flow that transfers USDC from L1 to L2.
 * This is a prerequisite for privacy-preserving deposits to Aave.
 *
 * BRIDGE FLOW (L1 only):
 * 1. Approve TokenPortal to spend USDC on L1
 * 2. Call depositToAztecPrivate on TokenPortal (locks USDC, sends L1→L2 message)
 *
 * After the L1 deposit completes, the user must separately claim tokens on L2
 * via the ClaimPendingBridges UI once the L1→L2 message is synced.
 *
 * The secret/secretHash pair ensures only the intended recipient can claim
 * the bridged tokens on L2.
 */

import { type Address, type Hex, pad, toHex } from "viem";

// L1 Services
import type { L1Clients } from "../services/l1/client.js";
import {
  type DepositToAztecPrivateResult,
  depositToAztecPrivate,
} from "../services/l1/tokenPortal.js";
import { allowance, approve, balanceOf } from "../services/l1/tokens.js";

// L2 Services
import { type Fr, generateSecretPair } from "../services/l2/crypto.js";
import type { AztecAddress } from "../services/l2/wallet.js";
import { storeSecret } from "../services/secrets.js";
// Store
import {
  clearOperation,
  setOperationError,
  setOperationStatus,
  setOperationStep,
  startOperation,
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
// Constants
// =============================================================================

/** Number of steps in the bridge flow (approve + deposit) */
const BRIDGE_STEP_COUNT = 2;

// =============================================================================
// Types
// =============================================================================

/**
 * L1 contract addresses required for bridge flow
 */
export interface BridgeL1Addresses {
  /** TokenPortal contract address */
  tokenPortal: Address;
  /** Mock USDC token address */
  mockUsdc: Address;
}

/**
 * Configuration for bridge operation
 */
export interface BridgeConfig {
  /** Amount to bridge (in token's smallest unit, e.g., 1_000_000 = 1 USDC) */
  amount: bigint;
}

/**
 * Result of a successful bridge operation.
 *
 * Note: The bridge flow only handles L1 deposit. The L2 claim must be done
 * separately via the ClaimPendingBridges UI once the L1→L2 message is ready.
 */
export interface BridgeResult {
  /** Secret used for L2 claiming (stored securely for later use) */
  secret: Fr;
  /** Hash of the secret */
  secretHash: Fr;
  /** Amount bridged */
  amount: bigint;
  /** Transaction hashes for each step */
  txHashes: {
    l1Approve?: string;
    l1Deposit?: string;
  };
  /** L1→L2 message key from TokenPortal */
  messageKey: Hex;
  /** L1→L2 message index */
  messageIndex: bigint;
}

/**
 * Bridge flow error with step information
 */
export class BridgeFlowError extends Error {
  constructor(
    public readonly step: number,
    public readonly stepName: string,
    public readonly cause: unknown
  ) {
    const message = cause instanceof Error ? cause.message : "Unknown error";
    super(`Bridge failed at step ${step} (${stepName}): ${message}`);
    this.name = "BridgeFlowError";
  }
}

// =============================================================================
// Main Bridge Flow
// =============================================================================

/**
 * Execute the bridge flow to transfer USDC from L1 to L2.
 *
 * This function orchestrates the L1 portion of the bridge:
 * 1. Approve TokenPortal to spend USDC on L1
 * 2. Call depositToAztecPrivate on TokenPortal (creates L1→L2 message)
 *
 * After this completes, the user must separately claim tokens on L2 via
 * the ClaimPendingBridges UI once the L1→L2 message is synced.
 *
 * The secret/secretHash pair is generated automatically and stored
 * securely for use during the L2 claim.
 *
 * @param l1Clients - L1 public and wallet clients
 * @param l1Addresses - L1 contract addresses
 * @param l2WalletAddress - L2 wallet address (for storing secret)
 * @param config - Bridge configuration
 * @returns Bridge result with message details for later claiming
 * @throws BridgeFlowError if any step fails
 *
 * @example
 * ```ts
 * const result = await executeBridgeFlow(
 *   l1Clients,
 *   { tokenPortal: '0x...', mockUsdc: '0x...' },
 *   l2WalletAddress,
 *   { amount: 1_000_000n } // 1 USDC
 * );
 * console.log(`Bridged! Message: ${result.messageKey}`);
 * // User must now claim via ClaimPendingBridges UI
 * ```
 */
export async function executeBridgeFlow(
  l1Clients: L1Clients,
  l1Addresses: BridgeL1Addresses,
  l2WalletAddress: AztecAddress,
  config: BridgeConfig
): Promise<BridgeResult> {
  const { publicClient, userWallet } = l1Clients;
  const { amount } = config;
  const txHashes: BridgeResult["txHashes"] = {};

  // Track current step for error reporting
  let currentStep = 0;

  // Initialize operation tracking
  startOperation("deposit", BRIDGE_STEP_COUNT); // Using "deposit" type for UI consistency

  try {
    // =========================================================================
    // Step 1: Approve TokenPortal to spend USDC
    // =========================================================================
    currentStep = 1;
    logStep(1, BRIDGE_STEP_COUNT, "Approve TokenPortal for USDC");
    setOperationStep(1);

    // Generate secret pair for L2 claiming
    const { secret, secretHash } = await generateSecretPair();
    const secretHashHex = pad(toHex(secretHash.toBigInt()), { size: 32 }) as Hex;

    logInfo(`Amount to bridge: ${formatUSDC(amount)} USDC`);
    logInfo(`Secret hash: ${secretHashHex.slice(0, 18)}...`);

    const userAddress = userWallet.account.address;

    // Check user's USDC balance
    const userBalance = await balanceOf(publicClient, l1Addresses.mockUsdc, userAddress);
    logInfo(`User USDC balance: ${formatUSDC(userBalance)}`);

    if (userBalance < amount) {
      throw new Error(
        `Insufficient USDC balance: ${formatUSDC(userBalance)} < ${formatUSDC(amount)}`
      );
    }

    // Check current allowance
    const currentAllowance = await allowance(
      publicClient,
      l1Addresses.mockUsdc,
      userAddress,
      l1Addresses.tokenPortal
    );

    if (currentAllowance < amount) {
      logInfo("Approving TokenPortal to spend USDC...");
      const approveResult = await approve(
        publicClient,
        userWallet,
        l1Addresses.mockUsdc,
        l1Addresses.tokenPortal,
        amount
      );
      txHashes.l1Approve = approveResult.txHash;
      logSuccess(`Approved (tx: ${approveResult.txHash.slice(0, 10)}...)`);
    } else {
      logInfo(`Sufficient allowance exists: ${formatUSDC(currentAllowance)}`);
    }

    // =========================================================================
    // Step 2: Call depositToAztecPrivate on TokenPortal
    // =========================================================================
    currentStep = 2;
    logStep(2, BRIDGE_STEP_COUNT, "Deposit to TokenPortal (L1→L2 message)");
    setOperationStep(2);

    logInfo("Calling depositToAztecPrivate on TokenPortal...");

    const depositResult: DepositToAztecPrivateResult = await depositToAztecPrivate(
      publicClient,
      userWallet,
      l1Addresses.tokenPortal,
      amount,
      secretHashHex
    );

    txHashes.l1Deposit = depositResult.txHash;
    const messageKey = depositResult.messageKey;
    const messageIndex = depositResult.messageIndex;

    logSuccess(`Deposit tx: ${depositResult.txHash.slice(0, 10)}...`);
    logInfo(`Message key: ${messageKey.slice(0, 18)}...`);
    logInfo(`Message index: ${messageIndex}`);

    // Store the secret for later L2 claiming
    // We use the messageKey as a unique identifier for this bridge operation
    console.log("[bridge] Storing secret with messageKey:", messageKey);
    console.log("[bridge] L2 wallet address:", l2WalletAddress.toString());
    await storeSecret(messageKey, secret.toString(), l2WalletAddress.toString());
    logInfo("Secret stored securely for L2 claiming");

    // Mark operation as successful
    setOperationStatus("success");
    logSuccess("Bridge L1 deposit complete!");
    logInfo(
      "Tokens will be available to claim on L2 once the message syncs (typically 30-90 seconds)."
    );

    return {
      secret,
      secretHash,
      amount,
      txHashes,
      messageKey,
      messageIndex,
    };
  } catch (error) {
    setOperationError(error instanceof Error ? error.message : "Unknown error");

    // Re-throw specific error types without wrapping
    if (
      error instanceof BridgeFlowError ||
      error instanceof UserRejectedError ||
      error instanceof NetworkError ||
      error instanceof TimeoutError
    ) {
      throw error;
    }

    // Detect and throw specific error types
    if (isUserRejection(error)) {
      throw new UserRejectedError(currentStep, "bridge");
    }

    if (isNetworkError(error)) {
      throw new NetworkError(currentStep, "bridge", error);
    }

    if (isTimeoutError(error)) {
      throw new TimeoutError(currentStep, "bridge");
    }

    // Fall through to generic bridge flow error
    throw new BridgeFlowError(currentStep, "bridge", error);
  } finally {
    // Always reset operation state to idle when flow completes (success or error)
    clearOperation();
  }
}

/**
 * Execute bridge flow with automatic retry on transient failures.
 *
 * @param l1Clients - L1 clients
 * @param l1Addresses - L1 addresses
 * @param l2WalletAddress - L2 wallet address (for storing secret)
 * @param config - Bridge config
 * @param maxRetries - Maximum retry attempts (default: 3)
 * @returns Bridge result
 */
export async function executeBridgeFlowWithRetry(
  l1Clients: L1Clients,
  l1Addresses: BridgeL1Addresses,
  l2WalletAddress: AztecAddress,
  config: BridgeConfig,
  maxRetries = 3
): Promise<BridgeResult> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logInfo(`Bridge attempt ${attempt}/${maxRetries}`);
      return await executeBridgeFlow(l1Clients, l1Addresses, l2WalletAddress, config);
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

  throw lastError ?? new Error("Bridge failed after retries");
}

/**
 * Get the step count for the bridge flow (for UI progress indicators).
 */
export function getBridgeStepCount(): number {
  return BRIDGE_STEP_COUNT;
}
