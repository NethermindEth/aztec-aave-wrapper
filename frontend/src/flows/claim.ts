/**
 * Token Claim Flow Orchestrator
 *
 * Implements the flow for claiming tokens after withdrawal executes on L1.
 * This is the final step after a successful withdrawal - the user claims their
 * L2 tokens via the BridgedToken contract.
 *
 * CLAIM FLOW:
 * 1. Wait for L1→L2 message to be available
 * 2. Call claim_private on BridgedToken contract
 *
 * FAILURE MODES:
 * - Message not yet available when claim attempted
 * - Secret hash mismatch (wrong secret provided)
 */

import type { Chain, Hex, PublicClient, Transport } from "viem";

// L1 Services
import { mineL1Block } from "../services/l1/mining.js";
import { type BridgedTokenContract, claimPrivate } from "../services/l2/bridgedToken.js";
// L2 Services
import type { AztecNodeClient } from "../services/l2/client.js";
import type { AztecAddress } from "../services/l2/wallet.js";

// Store
import {
  clearOperation,
  setOperationError,
  setOperationStatus,
  setOperationStep,
  startOperation,
} from "../store/actions.js";
import { logError, logInfo, logSection, logStep, logSuccess } from "../store/logger.js";
import {
  isNetworkError,
  isTimeoutError,
  isUserRejection,
  NetworkError,
  TimeoutError,
  UserRejectedError,
} from "../types/errors.js";
import { getClaimStepCount } from "../types/operations.js";
import { formatUSDC } from "../types/state.js";

// Re-export shared error types for consumers importing from this module
export { NetworkError, TimeoutError, UserRejectedError } from "../types/errors.js";

// =============================================================================
// Types
// =============================================================================

/**
 * L2 context for claim operations
 */
export interface ClaimL2Context {
  /** Aztec node client */
  node: AztecNodeClient;
  /** User wallet wrapper with address accessor */
  wallet: { address: AztecAddress };
  /** BridgedToken contract instance */
  bridgedTokenContract: BridgedTokenContract;
}

/**
 * Configuration for token claim operation
 */
export interface ClaimConfig {
  /** Amount to claim (in token's smallest unit, e.g., 1_000_000 = 1 USDC) */
  amount: bigint;
  /** Secret that hashes to the secretHash used in L1 deposit */
  secret: bigint;
  /** Index of the L1->L2 message in the message tree */
  messageLeafIndex: bigint;
  /** Message leaf hash from the L1 withdrawal execution event */
  messageLeaf?: Hex;
}

/**
 * Result of a successful claim operation
 */
export interface ClaimResult {
  /** Amount claimed */
  amount: bigint;
  /** Transaction hash for the L2 claim */
  txHash: string;
}

/**
 * Claim flow error with step information
 */
export class ClaimFlowError extends Error {
  constructor(
    public readonly step: number,
    public readonly stepName: string,
    public readonly cause: unknown
  ) {
    const message = cause instanceof Error ? cause.message : "Unknown error";
    super(`Claim failed at step ${step} (${stepName}): ${message}`);
    this.name = "ClaimFlowError";
  }
}

/**
 * Error thrown when the L1→L2 message is not yet available
 */
export class MessageNotAvailableError extends Error {
  constructor(messageLeaf?: string) {
    const leafInfo = messageLeaf ? ` (leaf: ${messageLeaf.slice(0, 18)}...)` : "";
    super(`L1→L2 message not yet available for claiming${leafInfo}`);
    this.name = "MessageNotAvailableError";
  }

  /** This error is retriable - the message may become available later */
  get isRetriable(): boolean {
    return true;
  }
}

/**
 * Error thrown when the secret hash doesn't match
 */
export class SecretHashMismatchError extends Error {
  constructor() {
    super("Secret hash mismatch - the provided secret does not match the expected hash");
    this.name = "SecretHashMismatchError";
  }

  /** This error is NOT retriable - the secret is wrong */
  get isRetriable(): boolean {
    return false;
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Wait for L1→L2 message to be consumable on L2.
 *
 * Uses the Aztec node's `getL1ToL2MessageBlock` API to poll for message availability
 * when a message leaf is provided. Otherwise falls back to time-based waiting.
 *
 * @param publicClient - L1 public client (for mining blocks to advance time)
 * @param node - Aztec node client
 * @param messageLeaf - Optional message leaf hash from the L1 event
 * @param maxWaitMs - Maximum wait time in milliseconds (default: 120s)
 * @param pollIntervalMs - Polling interval (default: 5s)
 * @returns True if message is ready, false if timeout
 */
async function waitForL1ToL2Message(
  publicClient: PublicClient<Transport, Chain>,
  node: AztecNodeClient,
  messageLeaf?: Hex,
  maxWaitMs = 120_000, // 2 minutes
  pollIntervalMs = 5000 // 5 seconds between polls
): Promise<boolean> {
  logSection("L1→L2", "Waiting for message to be synced by archiver...");

  const startTime = Date.now();

  // Mine initial L1 blocks to trigger archiver sync
  logInfo("Mining L1 blocks to trigger archiver sync...");
  for (let i = 0; i < 3; i++) {
    try {
      await mineL1Block(publicClient);
    } catch {
      // Ignore mining errors in non-devnet environments
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // If we have the message leaf, use the proper API to poll
  if (messageLeaf) {
    logInfo(`Message leaf: ${messageLeaf.slice(0, 18)}...`);
    const { Fr } = await import("@aztec/aztec.js/fields");
    const messageLeafFr = Fr.fromString(messageLeaf);

    let pollCount = 0;
    let lastBlockMined = Date.now();
    const minMineInterval = 20000; // Mine L1 every 20s

    while (Date.now() - startTime < maxWaitMs) {
      pollCount++;

      try {
        const currentBlock = await node.getBlockNumber();
        const messageBlockNumber = await node.getL1ToL2MessageBlock(messageLeafFr);

        if (messageBlockNumber === undefined) {
          logInfo(`Poll ${pollCount}: Message not yet indexed (L2 block=${currentBlock})`);
        } else if (currentBlock < messageBlockNumber) {
          logInfo(
            `Poll ${pollCount}: Message at block ${messageBlockNumber}, current=${currentBlock}`
          );
        } else {
          // Message should be available - verify with membership witness if possible
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const nodeAny = node as any;

          if (typeof nodeAny.getL1ToL2MembershipWitness === "function") {
            try {
              const witness = await nodeAny.getL1ToL2MembershipWitness(currentBlock, messageLeafFr);

              if (witness && witness.length > 0) {
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                logSuccess(`L1→L2 message is consumable! (${elapsed}s, block ${currentBlock})`);
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
            // Fallback: trust block number check if no witness API
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            logSuccess(`L1→L2 message indexed at block ${currentBlock} (${elapsed}s)`);
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

  // Fallback: time-based waiting when no message leaf provided
  logInfo("No message leaf provided, using time-based wait...");
  const initialL2Block = await node.getBlockNumber();
  let lastL2Block = initialL2Block;
  let blocksAdvanced = 0;
  const requiredBlockAdvance = 4;
  let lastBlockMined = Date.now();
  const minMineInterval = 20000;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const currentL2Block = await node.getBlockNumber();

      if (currentL2Block > lastL2Block) {
        blocksAdvanced += currentL2Block - lastL2Block;
        lastL2Block = currentL2Block;
        logInfo(`L2 block ${currentL2Block} (+${blocksAdvanced} total)`);

        if (blocksAdvanced >= requiredBlockAdvance) {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          logSuccess(
            `L1→L2 message should be consumable (${elapsed}s, ${blocksAdvanced} L2 blocks)`
          );
          return true;
        }
      }

      // Mine L1 block periodically
      if (Date.now() - lastBlockMined > minMineInterval) {
        try {
          await mineL1Block(publicClient);
        } catch {
          // Ignore mining errors
        }
        lastBlockMined = Date.now();
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    } catch (error) {
      logInfo(`Polling... (${error instanceof Error ? error.message : ""})`);
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  logInfo(`Wait completed (${elapsed}s, ${blocksAdvanced} L2 blocks) - proceeding anyway`);
  return blocksAdvanced >= 2; // Allow claim attempt if some blocks advanced
}

// =============================================================================
// Main Claim Flow
// =============================================================================

/**
 * Execute the token claim flow after withdrawal executes on L1.
 *
 * This function orchestrates the 2 steps of the claim process:
 * 1. Wait for L1→L2 message to be available
 * 2. Call claim_private on BridgedToken contract
 *
 * @param publicClient - L1 public client (for mining blocks)
 * @param l2Context - L2 node, wallet, and BridgedToken contract
 * @param config - Claim configuration
 * @returns Claim result with transaction hash
 * @throws ClaimFlowError if any step fails
 * @throws MessageNotAvailableError if message not ready after waiting
 * @throws SecretHashMismatchError if secret doesn't match (detected from contract error)
 *
 * @example
 * ```ts
 * const result = await executeTokenClaim(
 *   publicClient,
 *   { node, wallet, bridgedTokenContract },
 *   { amount: 1_000_000n, messageLeaf: '0x...' }
 * );
 * console.log(`Claimed! Tx: ${result.txHash}`);
 * ```
 */
export async function executeTokenClaim(
  publicClient: PublicClient<Transport, Chain>,
  l2Context: ClaimL2Context,
  config: ClaimConfig
): Promise<ClaimResult> {
  const { node, wallet, bridgedTokenContract } = l2Context;
  const { amount, secret, messageLeafIndex, messageLeaf } = config;

  // Track current step for error reporting
  let currentStep = 0;

  // Initialize operation tracking
  const totalSteps = getClaimStepCount();
  startOperation("claim", totalSteps);

  try {
    // =========================================================================
    // Step 1: Wait for L1→L2 message to be available
    // =========================================================================
    currentStep = 1;
    logStep(1, totalSteps, "Wait for L1→L2 message");
    setOperationStep(1);

    logInfo(`Amount to claim: ${formatUSDC(amount)} USDC`);

    const messageReady = await waitForL1ToL2Message(
      publicClient,
      node,
      messageLeaf,
      120_000, // 2 minute timeout
      5000 // 5 second poll interval
    );

    if (!messageReady) {
      throw new MessageNotAvailableError(messageLeaf);
    }

    // =========================================================================
    // Step 2: Call claim_private on BridgedToken
    // =========================================================================
    currentStep = 2;
    logStep(2, totalSteps, "Claim tokens on L2");
    setOperationStep(2);

    logInfo("Calling claim_private on BridgedToken...");

    try {
      const claimResult = await claimPrivate(
        bridgedTokenContract,
        {
          amount,
          secret,
          messageLeafIndex,
        },
        wallet.address
      );

      const txHash = claimResult.txHash;
      logSuccess(`Tokens claimed! Tx: ${txHash}`);

      // Mark operation as successful
      setOperationStatus("success");
      logSuccess("Claim flow complete!");

      return {
        amount,
        txHash,
      };
    } catch (error) {
      // Check for secret hash mismatch errors
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (
        errorMsg.includes("secret") ||
        errorMsg.includes("hash") ||
        errorMsg.includes("mismatch") ||
        errorMsg.includes("invalid proof")
      ) {
        throw new SecretHashMismatchError();
      }
      throw error;
    }
  } catch (error) {
    setOperationError(error instanceof Error ? error.message : "Unknown error");

    // Re-throw specific error types without wrapping
    if (
      error instanceof ClaimFlowError ||
      error instanceof MessageNotAvailableError ||
      error instanceof SecretHashMismatchError ||
      error instanceof UserRejectedError ||
      error instanceof NetworkError ||
      error instanceof TimeoutError
    ) {
      throw error;
    }

    // Detect and throw specific error types
    if (isUserRejection(error)) {
      throw new UserRejectedError(currentStep, "claim");
    }

    if (isNetworkError(error)) {
      throw new NetworkError(currentStep, "claim", error);
    }

    if (isTimeoutError(error)) {
      throw new TimeoutError(currentStep, "claim");
    }

    // Fall through to generic claim flow error
    throw new ClaimFlowError(currentStep, "claim", error);
  } finally {
    // Always reset operation state to idle when flow completes (success or error)
    clearOperation();
  }
}

/**
 * Execute token claim flow with automatic retry on transient failures.
 *
 * Note: MessageNotAvailableError, SecretHashMismatchError, and UserRejectedError
 * are handled specially:
 * - MessageNotAvailableError: Retried (message may become available)
 * - SecretHashMismatchError: NOT retried (permanent - wrong secret)
 * - UserRejectedError: NOT retried (intentional user action)
 *
 * @param publicClient - L1 public client
 * @param l2Context - L2 context
 * @param config - Claim config
 * @param maxRetries - Maximum retry attempts (default: 3)
 * @returns Claim result
 */
export async function executeTokenClaimWithRetry(
  publicClient: PublicClient<Transport, Chain>,
  l2Context: ClaimL2Context,
  config: ClaimConfig,
  maxRetries = 3
): Promise<ClaimResult> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logInfo(`Claim attempt ${attempt}/${maxRetries}`);
      return await executeTokenClaim(publicClient, l2Context, config);
    } catch (error) {
      // Don't retry permanent failures or user rejections
      if (error instanceof SecretHashMismatchError || error instanceof UserRejectedError) {
        throw error;
      }

      lastError = error instanceof Error ? error : new Error(String(error));
      logError(`Attempt ${attempt} failed: ${lastError.message}`);

      if (attempt < maxRetries) {
        // Longer delay for MessageNotAvailableError since we're waiting for L1→L2 sync
        const baseDelay = error instanceof MessageNotAvailableError ? 30000 : 1000;
        const delay = Math.min(baseDelay * 2 ** (attempt - 1), 60000);
        logInfo(`Retrying in ${delay / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError ?? new Error("Claim failed after retries");
}

// Re-export getClaimStepCount for consumers of this module
export { getClaimStepCount } from "../types/operations.js";

// =============================================================================
// Bridge Claim Flow
// =============================================================================

import type { PendingBridge } from "../services/pendingBridges.js";
import { removeSecret } from "../services/secrets.js";

/**
 * Result of a bridge claim operation
 */
export interface BridgeClaimResult {
  /** Whether the claim was successful */
  success: boolean;
  /** L2 transaction hash (if successful) */
  txHash?: string;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Result of message readiness check for bridge claim
 */
export interface BridgeMessageReadyResult {
  /** Whether the message is ready to be consumed */
  ready: boolean;
  /** Current L2 block number */
  currentBlock?: number;
  /** Block at which message will be available */
  availableAtBlock?: number;
  /** Actual leaf index in the L2 message tree (from membership witness) */
  leafIndex?: bigint;
}

/**
 * Check if an L1→L2 bridge message is ready to be consumed.
 *
 * @param node - Aztec node client
 * @param messageKey - L1→L2 message key (leaf hash)
 * @returns Message readiness result
 */
export async function checkBridgeMessageReady(
  node: AztecNodeClient,
  messageKey: string
): Promise<BridgeMessageReadyResult> {
  try {
    const { Fr } = await import("@aztec/aztec.js/fields");
    const messageLeafFr = Fr.fromString(messageKey);

    const currentBlock = await node.getBlockNumber();
    const messageBlockNumber = await node.getL1ToL2MessageBlock(messageLeafFr);

    if (messageBlockNumber === undefined) {
      return { ready: false, currentBlock };
    }

    if (currentBlock < messageBlockNumber) {
      return {
        ready: false,
        currentBlock,
        availableAtBlock: messageBlockNumber,
      };
    }

    // Get the membership witness which includes the ACTUAL leaf index
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeAny = node as any;

    if (typeof nodeAny.getL1ToL2MembershipWitness === "function") {
      try {
        const witness = await nodeAny.getL1ToL2MembershipWitness(currentBlock, messageLeafFr);
        if (witness && witness.length >= 2) {
          const leafIndex = witness[0];
          return {
            ready: true,
            currentBlock,
            leafIndex:
              typeof leafIndex === "bigint"
                ? leafIndex
                : BigInt(leafIndex?.toString?.() ?? leafIndex),
          };
        }
        return {
          ready: false,
          currentBlock,
          availableAtBlock: messageBlockNumber,
        };
      } catch {
        return { ready: true, currentBlock };
      }
    }

    return { ready: true, currentBlock };
  } catch (error) {
    logError(
      `Failed to check message readiness: ${error instanceof Error ? error.message : "Unknown"}`
    );
    return { ready: false };
  }
}

/**
 * Execute the claim flow for a pending bridge.
 *
 * The PendingBridge now contains all necessary data:
 * - secret: The secret for claiming (from local storage, already retrieved)
 * - leafIndex: The actual L2 message tree leaf index (from membership witness)
 *
 * @param l2Context - L2 node, wallet, and BridgedToken contract
 * @param pendingBridge - The pending bridge to claim (with secret and leafIndex)
 * @returns Claim result
 *
 * @example
 * ```ts
 * const result = await executeBridgeClaim(
 *   { node, wallet, bridgedTokenContract },
 *   pendingBridge
 * );
 * if (result.success) {
 *   console.log(`Claimed! TX: ${result.txHash}`);
 * }
 * ```
 */
export async function executeBridgeClaim(
  l2Context: ClaimL2Context,
  pendingBridge: PendingBridge
): Promise<BridgeClaimResult> {
  const { wallet, bridgedTokenContract } = l2Context;

  logSection("Bridge Claim", `Claiming bridge ${pendingBridge.messageKey.slice(0, 12)}...`);

  try {
    if (!pendingBridge.secret) {
      const error = "Secret not found in bridge data - cannot claim without the original secret";
      return { success: false, error };
    }

    if (pendingBridge.leafIndex === undefined) {
      const error = "Leaf index not available - message may not be ready yet";
      return { success: false, error };
    }

    if (pendingBridge.status !== "ready") {
      const error = `Bridge is not ready to claim (status: ${pendingBridge.status})`;
      return { success: false, error };
    }

    const amount = BigInt(pendingBridge.amount);
    const secret = BigInt(pendingBridge.secret);
    const messageLeafIndex = pendingBridge.leafIndex;

    logInfo("Calling claim_private on BridgedToken...");
    logInfo(`  amount: ${amount}`);
    logInfo(`  secret: ${secret.toString(16).slice(0, 16)}...`);
    logInfo(`  messageLeafIndex: ${messageLeafIndex}`);

    const claimResult = await claimPrivate(
      bridgedTokenContract,
      {
        amount,
        secret,
        messageLeafIndex,
      },
      wallet.address
    );

    logSuccess(`Tokens claimed! TX: ${claimResult.txHash}`);

    // Remove the secret after successful claim
    removeSecret(pendingBridge.messageKey);

    return {
      success: true,
      txHash: claimResult.txHash,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logError(`Claim failed: ${errorMessage}`);

    return { success: false, error: errorMessage };
  }
}

// Note: refreshBridgeStatuses and recoverPendingBridges are now handled by
// scanPendingBridges in pendingBridges.ts which derives all state from chain data.
