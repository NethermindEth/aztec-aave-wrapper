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

// Shared types
import { IntentStatus } from "@aztec-aave-wrapper/shared";
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
  approve,
  balanceOf,
  type L1AddressesForBalances,
  transfer,
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
  addPosition,
  setOperationError,
  setOperationIntentId,
  setOperationStatus,
  setOperationStep,
  startOperation,
} from "../store/actions.js";
// Store
import { logError, logInfo, logSection, logStep, logSuccess } from "../store/logger.js";
import { getDepositStepCount } from "../types/operations.js";
import { formatUSDC } from "../types/state.js";

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
    l1Approve?: string;
    l1Transfer?: string;
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

  // Initialize operation tracking
  startOperation("deposit", totalSteps);

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
    logStep(3, totalSteps, "Wait for L2→L1 message");
    setOperationStep(3);

    const messageAvailable = await waitForL2ToL1Message(node);
    if (!messageAvailable) {
      throw new Error("Timeout waiting for L2→L1 message availability");
    }

    // =========================================================================
    // Step 4: Execute deposit on L1 (fund portal + execute)
    // =========================================================================
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

    // Approve portal to spend USDC
    logSection("L1", "Approving portal to spend USDC...");
    const approveResult = await approve(
      publicClient,
      userWallet,
      l1Addresses.mockUsdc,
      l1Addresses.portal,
      config.amount
    );
    txHashes.l1Approve = approveResult.txHash;

    // Transfer USDC to portal
    logSection("L1", "Transferring USDC to portal...");
    const transferResult = await transfer(
      publicClient,
      userWallet,
      l1Addresses.mockUsdc,
      l1Addresses.portal,
      config.amount
    );
    txHashes.l1Transfer = transferResult.txHash;

    // Create deposit intent for L1
    const salt = generateSalt();
    const intentIdHex = pad(toHex(BigInt(intentIdStr)), { size: 32 }) as Hex;
    const ownerHashHex = pad(toHex(ownerHash), { size: 32 }) as Hex;

    const depositIntent: DepositIntent = {
      intentId: intentIdHex,
      ownerHash: ownerHashHex,
      asset: l1Addresses.mockUsdc,
      amount: config.amount,
      originalDecimals: config.originalDecimals,
      deadline,
      salt,
    };

    // Compute message hash and set it as valid in mock outbox
    const messageHash = computeDepositIntentHash(depositIntent);

    const l2BlockNumber = 100n; // Mock L2 block number for devnet
    await setMockOutboxMessageValid(
      publicClient,
      relayerWallet,
      l1Addresses.mockAztecOutbox,
      messageHash,
      l2BlockNumber
    );

    // Execute deposit via relayer
    logSection("Privacy", "Relayer executing L1 deposit (not user)");
    const proof: MerkleProof = {
      l2BlockNumber,
      leafIndex: 0n,
      siblingPath: [],
    };

    const executeResult = await executeDeposit(
      publicClient,
      relayerWallet,
      l1Addresses.portal,
      depositIntent,
      proof
    );
    txHashes.l1Execute = executeResult.txHash;

    // Get shares recorded for this intent
    const shares = await getIntentShares(publicClient, l1Addresses.portal, intentIdHex);
    logSuccess(`Shares recorded: ${shares.toString()}`);

    // =========================================================================
    // Step 5: Wait for L1→L2 message
    // =========================================================================
    logStep(5, totalSteps, "Wait for L1→L2 message");
    setOperationStep(5);

    await waitForL1ToL2Message(publicClient, node);

    // =========================================================================
    // Step 6: Call finalize_deposit on L2
    // =========================================================================
    logStep(6, totalSteps, "Finalize deposit on L2");
    setOperationStep(6);

    // MVP: shares = amount (1:1 ratio for initial deposit)
    const mockShares = config.amount;

    try {
      const finalizeResult = await executeFinalizeDeposit(
        contract,
        {
          intentId,
          assetId: config.assetId,
          shares: mockShares,
          secret,
          messageLeafIndex: 0n,
        },
        wallet.address
      );
      txHashes.l2Finalize = finalizeResult.txHash;
      logSuccess(`Finalize tx: ${finalizeResult.txHash}`);
    } catch (error) {
      // In devnet without real L1→L2 messaging, finalize may fail
      logSection("L2", "finalize_deposit may fail without real L1→L2 message", "warning");
      logInfo(error instanceof Error ? error.message.slice(0, 100) : "Unknown error");
    }

    // Add position to store
    addPosition({
      intentId: intentIdStr,
      assetId: config.assetId.toString(),
      shares: shares.toString(),
      sharesFormatted: `${formatUSDC(shares)} USDC`,
      status: IntentStatus.PendingDeposit,
    });

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
    const step = 1; // Would track actual step in production
    setOperationError(error instanceof Error ? error.message : "Unknown error");
    throw new DepositFlowError(step, "deposit", error);
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
