/**
 * Bridge Flow Orchestrator
 *
 * Implements the complete bridge flow that transfers USDC from L1 to L2.
 * This is a prerequisite for privacy-preserving deposits to Aave.
 *
 * BRIDGE FLOW:
 * 1. Approve TokenPortal to spend USDC on L1
 * 2. Call depositToAztecPrivate on TokenPortal (locks USDC, sends L1→L2 message)
 * 3. Wait for L1→L2 message to be available on L2
 * 4. Claim tokens on L2 via BridgedToken.claim_private
 *
 * The secret/secretHash pair ensures only the intended recipient can claim
 * the bridged tokens on L2.
 */

import {
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
  pad,
  toHex,
} from "viem";

// L1 Services
import type { L1Clients } from "../services/l1/client.js";
import { mineL1Block } from "../services/l1/mining.js";
import { approve, allowance, balanceOf } from "../services/l1/tokens.js";
import {
  depositToAztecPrivate,
  type DepositToAztecPrivateResult,
} from "../services/l1/tokenPortal.js";

// L2 Services
import type { AztecNodeClient } from "../services/l2/client.js";
import { generateSecretPair, type Fr } from "../services/l2/crypto.js";
import type { BridgedTokenContract } from "../services/l2/bridgedToken.js";
import { claimPrivate, generateRandomness } from "../services/l2/bridgedToken.js";
import type { AztecAddress } from "../services/l2/wallet.js";

// Store
import {
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
import { formatUSDC } from "../types/state.js";
import { storeSecret } from "../services/secrets.js";

// Re-export shared error types for consumers importing from this module
export { NetworkError, TimeoutError, UserRejectedError } from "../types/errors.js";

// =============================================================================
// Constants
// =============================================================================

/** Number of steps in the bridge flow */
const BRIDGE_STEP_COUNT = 3;

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
 * L2 context for bridge operations
 */
export interface BridgeL2Context {
  /** Aztec node client */
  node: AztecNodeClient;
  /** User wallet wrapper with address accessor */
  wallet: { address: AztecAddress };
  /** BridgedToken contract instance */
  bridgedTokenContract: BridgedTokenContract;
}

/**
 * Configuration for bridge operation
 */
export interface BridgeConfig {
  /** Amount to bridge (in token's smallest unit, e.g., 1_000_000 = 1 USDC) */
  amount: bigint;
}

/**
 * Result of a successful bridge operation
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
    l2Claim?: string;
  };
  /** L1→L2 message key from TokenPortal */
  messageKey: Hex;
  /** L1→L2 message index */
  messageIndex: bigint;
  /** Whether the L2 claim was successful */
  claimed: boolean;
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
// Helper Functions
// =============================================================================

/**
 * Wait for L1→L2 message to be consumable by polling the Aztec node.
 *
 * In devnet mode, we mine L1 blocks to trigger archiver sync and poll
 * for message availability using the node's getL1ToL2MessageBlock API.
 *
 * @param publicClient - L1 public client for mining blocks
 * @param node - Aztec node client
 * @param messageLeaf - Message leaf hash from L1 deposit event
 * @param maxWaitMs - Maximum wait time in milliseconds
 * @param pollIntervalMs - Polling interval in milliseconds
 * @returns True if message is ready, false if timeout
 */
async function waitForL1ToL2Message(
  publicClient: PublicClient<Transport, Chain>,
  node: AztecNodeClient,
  messageLeaf: Hex,
  maxWaitMs = 120_000, // 2 minutes
  pollIntervalMs = 5000 // 5 seconds between polls
): Promise<boolean> {
  logSection("L1→L2", "Waiting for message to be synced by archiver...");

  const startTime = Date.now();
  const { Fr } = await import("@aztec/aztec.js/fields");

  // Convert hex message leaf to Fr for querying
  const messageLeafFr = Fr.fromString(messageLeaf);
  logInfo(`Message leaf: ${messageLeaf.slice(0, 18)}...`);

  let pollCount = 0;
  let lastBlockMined = Date.now();
  const minMineInterval = 20000; // Mine L1 every 20s to trigger archiver

  while (Date.now() - startTime < maxWaitMs) {
    pollCount++;

    try {
      const currentBlock = await node.getBlockNumber();

      // Check which block the message will be available
      const messageBlockNumber = await node.getL1ToL2MessageBlock(messageLeafFr);

      if (messageBlockNumber === undefined) {
        logInfo(`Poll ${pollCount}: Message not yet indexed by archiver (L2 block=${currentBlock})`);
      } else if (currentBlock < messageBlockNumber) {
        logInfo(
          `Poll ${pollCount}: Message available at block ${messageBlockNumber}, current=${currentBlock}`
        );
      } else {
        // Message should be available - try to get the membership witness
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
          // Fallback: if no witness API, trust block number check
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

// =============================================================================
// Main Bridge Flow
// =============================================================================

/**
 * Execute the complete bridge flow to transfer USDC from L1 to L2.
 *
 * This function orchestrates all 3 steps of the bridge process:
 * 1. Approve TokenPortal to spend USDC on L1
 * 2. Call depositToAztecPrivate on TokenPortal
 * 3. Wait for L1→L2 message and claim tokens on L2
 *
 * The secret/secretHash pair is generated automatically. The secret is
 * stored securely and can be used to prove ownership during claiming.
 *
 * @param l1Clients - L1 public and wallet clients
 * @param l1Addresses - L1 contract addresses
 * @param l2Context - L2 node, wallet, and BridgedToken contract
 * @param config - Bridge configuration
 * @returns Bridge result with message details and claim status
 * @throws BridgeFlowError if any step fails
 *
 * @example
 * ```ts
 * const result = await executeBridgeFlow(
 *   l1Clients,
 *   { tokenPortal: '0x...', mockUsdc: '0x...' },
 *   { node, wallet, bridgedTokenContract },
 *   { amount: 1_000_000n } // 1 USDC
 * );
 * console.log(`Bridged! Claimed: ${result.claimed}, Message: ${result.messageKey}`);
 * ```
 */
export async function executeBridgeFlow(
  l1Clients: L1Clients,
  l1Addresses: BridgeL1Addresses,
  l2Context: BridgeL2Context,
  config: BridgeConfig
): Promise<BridgeResult> {
  const { publicClient, userWallet } = l1Clients;
  const { node, wallet, bridgedTokenContract } = l2Context;
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
    await storeSecret(messageKey, secret.toString(), wallet.address.toString());
    logInfo("Secret stored securely for L2 claiming");

    // =========================================================================
    // Step 3: Wait for L1→L2 message and claim on L2
    // =========================================================================
    currentStep = 3;
    logStep(3, BRIDGE_STEP_COUNT, "Claim tokens on L2");
    setOperationStep(3);

    // Wait for L1→L2 message to be available
    const messageReady = await waitForL1ToL2Message(
      publicClient,
      node,
      messageKey,
      120_000, // 2 minute timeout
      5000 // 5 second poll interval
    );

    let claimed = false;

    if (messageReady) {
      try {
        logInfo("Claiming bridged tokens on L2 via BridgedToken...");

        // Generate randomness for the private note
        const randomness = await generateRandomness();

        // Claim the tokens on L2
        const claimResult = await claimPrivate(
          bridgedTokenContract,
          {
            to: wallet.address,
            amount,
            randomness,
          },
          wallet.address
        );

        txHashes.l2Claim = claimResult.txHash;
        claimed = true;

        logSuccess(`L2 claim tx: ${claimResult.txHash}`);
      } catch (error) {
        // L2 claim may fail in mock mode without real L1→L2 message
        logSection("L2", "claim_private failed", "warning");
        logInfo(error instanceof Error ? error.message : "Unknown error");
        console.error("claim_private error:", error);
        // Don't throw - the bridge was still successful even if claim failed
        // User can retry the claim later
      }
    } else {
      logSection("L2", "Cannot claim - L1→L2 message not consumable", "warning");
      logInfo("The message may need more time to sync. Tokens can be claimed later.");
    }

    // Mark operation as successful
    setOperationStatus("success");
    logSuccess(`Bridge flow complete! Claimed: ${claimed}`);

    return {
      secret,
      secretHash,
      amount,
      txHashes,
      messageKey,
      messageIndex,
      claimed,
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
  }
}

/**
 * Execute bridge flow with automatic retry on transient failures.
 *
 * @param l1Clients - L1 clients
 * @param l1Addresses - L1 addresses
 * @param l2Context - L2 context
 * @param config - Bridge config
 * @param maxRetries - Maximum retry attempts (default: 3)
 * @returns Bridge result
 */
export async function executeBridgeFlowWithRetry(
  l1Clients: L1Clients,
  l1Addresses: BridgeL1Addresses,
  l2Context: BridgeL2Context,
  config: BridgeConfig,
  maxRetries = 3
): Promise<BridgeResult> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logInfo(`Bridge attempt ${attempt}/${maxRetries}`);
      return await executeBridgeFlow(l1Clients, l1Addresses, l2Context, config);
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
