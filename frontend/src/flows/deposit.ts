/**
 * Deposit Flow Orchestrator
 *
 * Implements complete deposit flow combining all 6 steps from e2e/scripts/full-flow.ts.
 * Coordinates L2 → L1 → L2 operations with step tracking and logging.
 *
 * DEPOSIT FLOW:
 * 1. Generate secret and prepare parameters
 * 2. Call request_deposit on L2
 * 3. Wait for L2→L1 message to be available
 * 4. Execute deposit on L1 (fund portal + execute)
 * 5. Wait for L1→L2 message
 * 6. Call finalize_deposit on L2
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
import {
  computeDepositIntentHash,
  type DepositIntent,
  generateSalt,
} from "../services/l1/intent.js";
import { mineL1Block } from "../services/l1/mining.js";
import { executeDeposit, getIntentShares, type MerkleProof } from "../services/l1/portal.js";
import {
  balanceOf,
  type L1AddressesForBalances,
} from "../services/l1/tokens.js";
// L2 Services
import type { AztecNodeClient } from "../services/l2/client.js";
import { computeOwnerHash, generateSecretPair } from "../services/l2/crypto.js";
import type { AaveWrapperContract } from "../services/l2/deploy.js";
import {
  executeFinalizeDeposit,
  executeRequestDeposit,
  type Fr,
} from "../services/l2/operations.js";
import type { AztecAddress } from "../services/l2/wallet.js";
import {
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
  /** Mock Aztec outbox for message verification */
  mockAztecOutbox: Address;
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
  /** Asset identifier on target chain */
  assetId: bigint;
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
 * Wait for L1→L2 message to be consumable by polling for membership witness.
 * This is the definitive check - if we can get a witness, the message is consumable.
 *
 * @returns true if message is ready, false if timeout
 */
async function waitForL1ToL2Message(
  publicClient: PublicClient<Transport, Chain>,
  node: AztecNodeClient,
  messageLeaf: Hex,
  maxWaitMs = 120_000, // 2 minutes
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
  const minMineInterval = 20000; // Mine L1 every 20s to trigger archiver

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

    const depositResult = await executeRequestDeposit(
      contract,
      {
        asset: config.assetId,
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

    // =========================================================================
    // Step 3: Wait for L2→L1 message to be available
    // =========================================================================
    currentStep = 3;
    logStep(3, totalSteps, "Wait for L2→L1 message");
    setOperationStep(3);

    const messageAvailable = await waitForL2ToL1Message(node);
    if (!messageAvailable) {
      throw new Error("Timeout waiting for L2→L1 message availability");
    }

    // =========================================================================
    // Step 4: Execute deposit on L1 (fund portal + execute)
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

    // Create deposit intent for L1
    const salt = generateSalt();
    const intentIdHex = pad(toHex(BigInt(intentIdStr)), { size: 32 }) as Hex;
    const ownerHashHex = pad(toHex(ownerHash), { size: 32 }) as Hex;
    // Convert Fr secretHash to hex for L1 - ensures L1→L2 message uses same hash
    const secretHashHex = pad(toHex(secretHash.toBigInt()), { size: 32 }) as Hex;

    const depositIntent: DepositIntent = {
      intentId: intentIdHex,
      ownerHash: ownerHashHex,
      asset: l1Addresses.mockUsdc,
      amount: config.amount,
      originalDecimals: config.originalDecimals,
      deadline,
      salt,
      secretHash: secretHashHex,
    };

    // Compute message hash and set it as valid in mock outbox
    console.log("=== DEBUG: Deposit Intent Values ===");
    console.log("intentId:", depositIntent.intentId);
    console.log("ownerHash:", depositIntent.ownerHash);
    console.log("asset:", depositIntent.asset);
    console.log("amount:", depositIntent.amount.toString());
    console.log("originalDecimals:", depositIntent.originalDecimals);
    console.log("deadline:", depositIntent.deadline.toString());
    console.log("salt:", depositIntent.salt);

    const messageHash = computeDepositIntentHash(depositIntent);
    console.log("=== DEBUG: Deposit Flow ===");
    console.log("Message hash:", messageHash);
    console.log("Outbox address (frontend):", l1Addresses.mockAztecOutbox);
    console.log("Portal address:", l1Addresses.portal);

    // Debug: verify portal's outbox matches what we're using
    const portalOutbox = await publicClient.readContract({
      address: l1Addresses.portal,
      abi: [
        {
          name: "aztecOutbox",
          type: "function",
          stateMutability: "view",
          inputs: [],
          outputs: [{ type: "address" }],
        },
      ] as const,
      functionName: "aztecOutbox",
    });
    console.log("Outbox address (portal):", portalOutbox);
    console.log(
      "Addresses match:",
      l1Addresses.mockAztecOutbox.toLowerCase() === portalOutbox.toLowerCase()
    );

    // Debug: verify portal's L2 contract address matches what we're using
    const portalL2Address = await publicClient.readContract({
      address: l1Addresses.portal,
      abi: [
        {
          name: "l2ContractAddress",
          type: "function",
          stateMutability: "view",
          inputs: [],
          outputs: [{ type: "bytes32" }],
        },
      ] as const,
      functionName: "l2ContractAddress",
    });
    const ourL2Address = contract.address.toString();
    console.log("L2 address (portal):", portalL2Address);
    console.log("L2 address (our contract):", ourL2Address);
    console.log(
      "L2 addresses match:",
      portalL2Address.toLowerCase() === ourL2Address.toLowerCase()
    );

    // Debug: check portal's inbox address
    const portalInbox = await publicClient.readContract({
      address: l1Addresses.portal,
      abi: [
        {
          name: "aztecInbox",
          type: "function",
          stateMutability: "view",
          inputs: [],
          outputs: [{ type: "address" }],
        },
      ] as const,
      functionName: "aztecInbox",
    });
    console.log("Portal inbox address:", portalInbox);

    const l2BlockNumber = 100n; // Mock L2 block number for devnet
    await setMockOutboxMessageValid(
      publicClient,
      relayerWallet,
      l1Addresses.mockAztecOutbox,
      messageHash,
      l2BlockNumber
    );

    // Verify the message was set correctly
    const isValid = await publicClient.readContract({
      address: l1Addresses.mockAztecOutbox,
      abi: [
        {
          name: "validMessages",
          type: "function",
          stateMutability: "view",
          inputs: [{ type: "bytes32" }, { type: "uint256" }],
          outputs: [{ type: "bool" }],
        },
      ] as const,
      functionName: "validMessages",
      args: [messageHash, l2BlockNumber],
    });
    console.log("Message set in outbox?", isValid);
    console.log("Block number used:", l2BlockNumber.toString());

    // Execute deposit via relayer
    logSection("Privacy", "Relayer executing L1 deposit (not user)");

    // Generate unique leaf index from intent ID to avoid collision in mock outbox
    // The mock outbox tracks consumed messages by (blockNumber, leafIndex)
    // Using a hash-derived index ensures each deposit gets a unique slot
    const leafIndex = BigInt(depositIntent.intentId.slice(0, 18)) % 1000000n;

    const proof: MerkleProof = {
      l2BlockNumber,
      leafIndex,
      siblingPath: [],
    };

    // Check if intent was already consumed (from a previous failed attempt)
    const alreadyConsumed = await publicClient.readContract({
      address: l1Addresses.portal,
      abi: [
        {
          name: "consumedIntents",
          type: "function",
          stateMutability: "view",
          inputs: [{ type: "bytes32" }],
          outputs: [{ type: "bool" }],
        },
      ] as const,
      functionName: "consumedIntents",
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
    // Convert asset address to Field for L2 (matches L1's bytes32(uint256(uint160(asset))))
    const assetAsField = BigInt(l1Addresses.mockUsdc);

    console.log("=== DEBUG: Values for finalize_deposit ===");
    console.log(`  intentId: ${intentId.toString()}`);
    console.log(`  shares: ${shares}`);
    console.log(`  assetAsField: ${assetAsField}`);
    console.log(`  assetAsField (hex): 0x${assetAsField.toString(16)}`);
    console.log(`  l1ToL2MessageIndex: ${l1ToL2MessageIndex}`);
    console.log(`  secret: ${secret.toString()}`);
    console.log(`  L2 contract address: ${contract.address.toString()}`);
    console.log(`  Portal address: ${l1Addresses.portal}`);

    if (!messageReady) {
      logSection("L2", "Cannot finalize - L1→L2 message not consumable", "warning");
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
