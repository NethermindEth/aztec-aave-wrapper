/**
 * L1 Portal Execution Service
 *
 * Portal contract interaction functions for executing deposits and withdrawals.
 * Matches the pattern from e2e/scripts/full-flow.ts:720-728.
 */

import {
  type Abi,
  type Account,
  type Address,
  type Chain,
  type Hex,
  keccak256,
  type PublicClient,
  type Transport,
  toBytes,
  type WalletClient,
} from "viem";
import { logError, logInfo, logSuccess } from "../../store/logger.js";
import type { DepositIntent, WithdrawIntent } from "./intent.js";

// =============================================================================
// Portal ABI (minimal interface for deposit/withdraw operations)
// =============================================================================

/**
 * Minimal ABI for AztecAavePortalL1 contract.
 * Includes only the functions needed for executing intents and querying state.
 */
export const PORTAL_ABI = [
  // Read-only contract addresses
  {
    type: "function",
    name: "AZTEC_OUTBOX",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  // Execute functions
  {
    type: "function",
    name: "executeDeposit",
    inputs: [
      {
        name: "intent",
        type: "tuple",
        components: [
          { name: "intentId", type: "bytes32" },
          { name: "ownerHash", type: "bytes32" },
          { name: "asset", type: "address" },
          { name: "amount", type: "uint128" },
          { name: "originalDecimals", type: "uint8" },
          { name: "deadline", type: "uint64" },
          { name: "salt", type: "bytes32" },
          { name: "secretHash", type: "bytes32" },
        ],
      },
      { name: "l2BlockNumber", type: "uint256" },
      { name: "leafIndex", type: "uint256" },
      { name: "siblingPath", type: "bytes32[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "executeWithdraw",
    inputs: [
      {
        name: "intent",
        type: "tuple",
        components: [
          { name: "intentId", type: "bytes32" },
          { name: "ownerHash", type: "bytes32" },
          { name: "amount", type: "uint128" },
          { name: "deadline", type: "uint64" },
        ],
      },
      { name: "secretHash", type: "bytes32" },
      { name: "l2BlockNumber", type: "uint256" },
      { name: "leafIndex", type: "uint256" },
      { name: "siblingPath", type: "bytes32[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // View functions
  {
    type: "function",
    name: "getIntentShares",
    inputs: [{ name: "intentId", type: "bytes32" }],
    outputs: [{ name: "", type: "uint128" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getIntentAsset",
    inputs: [{ name: "intentId", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "consumedDepositIntents",
    inputs: [{ name: "intentId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "consumedWithdrawIntents",
    inputs: [{ name: "intentId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "intentShares",
    inputs: [{ name: "intentId", type: "bytes32" }],
    outputs: [{ name: "", type: "uint128" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "intentAssets",
    inputs: [{ name: "intentId", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  // Events
  {
    type: "event",
    name: "DepositExecuted",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "asset", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "shares", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WithdrawExecuted",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "asset", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DepositConfirmed",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "shares", type: "uint256", indexed: false },
      { name: "status", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WithdrawConfirmed",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "status", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "L2MessageSent",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "messageLeaf", type: "bytes32", indexed: false },
      { name: "messageIndex", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TokensDepositedToL2",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "messageKey", type: "bytes32", indexed: false },
      { name: "messageIndex", type: "uint256", indexed: false },
    ],
  },
] as const;

// =============================================================================
// Types
// =============================================================================

/**
 * Result of an executeDeposit call
 */
export interface ExecuteDepositResult {
  txHash: Hex;
  success: boolean;
  /** The L1→L2 message leaf index (for L2 consumption) */
  messageIndex: bigint;
  /** The L1→L2 message leaf (hash computed by L1 inbox) */
  messageLeaf: Hex;
}

/**
 * Result of an executeWithdraw call
 */
export interface ExecuteWithdrawResult {
  txHash: Hex;
  success: boolean;
  /** Actual amount withdrawn from Aave (may differ from requested due to interest) */
  withdrawnAmount: bigint;
  /** Message key for claiming tokens on L2 (from TokensDepositedToL2 event) */
  messageKey: Hex;
  /** The L1→L2 message leaf index (for L2 finalization) */
  messageIndex: bigint;
  /** The L1→L2 message leaf hash (from L2MessageSent event) */
  messageLeaf: Hex;
}

/**
 * Merkle proof data for L2→L1 message verification
 */
export interface MerkleProof {
  /** L2 block number where the message was created */
  l2BlockNumber: bigint;
  /** Index of the message leaf in the tree */
  leafIndex: bigint;
  /** Sibling path for Merkle proof verification */
  siblingPath: Hex[];
}

// =============================================================================
// Execute Functions
// =============================================================================

/**
 * Execute a deposit intent on L1.
 *
 * This function:
 * 1. Consumes the L2→L1 message from the Aztec outbox
 * 2. Supplies tokens to Aave
 * 3. Sends an L1→L2 confirmation message
 *
 * @param publicClient - Viem public client for waiting on receipts
 * @param walletClient - Viem wallet client (relayer) for signing
 * @param portalAddress - AztecAavePortalL1 contract address
 * @param intent - The deposit intent from L2
 * @param proof - Merkle proof for L2→L1 message verification
 * @param abi - Optional custom ABI (defaults to PORTAL_ABI)
 * @returns Transaction result
 *
 * @example
 * ```ts
 * const result = await executeDeposit(
 *   publicClient,
 *   relayerWallet,
 *   portalAddress,
 *   depositIntent,
 *   { l2BlockNumber: 100n, leafIndex: 0n, siblingPath: [] }
 * );
 * ```
 */
export async function executeDeposit(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain, Account>,
  portalAddress: Address,
  intent: DepositIntent,
  proof: MerkleProof,
  abi: Abi = PORTAL_ABI as unknown as Abi
): Promise<ExecuteDepositResult> {
  logInfo(`Executing deposit for intent ${intent.intentId.slice(0, 10)}...`);

  // Convert intent to the tuple format expected by the contract
  const intentTuple = {
    intentId: intent.intentId,
    ownerHash: intent.ownerHash,
    asset: intent.asset,
    amount: intent.amount,
    originalDecimals: intent.originalDecimals,
    deadline: intent.deadline,
    salt: intent.salt,
    secretHash: intent.secretHash,
  };

  const txHash = await walletClient.writeContract({
    address: portalAddress,
    abi,
    functionName: "executeDeposit",
    args: [intentTuple, proof.l2BlockNumber, proof.leafIndex, proof.siblingPath],
    gas: 5_000_000n,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  // Extract message index from L2MessageSent event
  // The event has signature: L2MessageSent(bytes32 indexed intentId, bytes32 messageLeaf, uint256 messageIndex)
  const L2_MESSAGE_SENT_TOPIC = keccak256(toBytes("L2MessageSent(bytes32,bytes32,uint256)"));

  let messageIndex = 0n;
  let messageLeaf = "0x0" as Hex;

  // Find the L2MessageSent event in logs by matching the event topic
  for (const log of receipt.logs) {
    // Check if this log is from the portal contract and is the L2MessageSent event
    if (
      log.address.toLowerCase() === portalAddress.toLowerCase() &&
      log.topics.length >= 2 &&
      log.topics[0]?.toLowerCase() === L2_MESSAGE_SENT_TOPIC.toLowerCase()
    ) {
      // L2MessageSent has 1 indexed param (intentId) + 2 non-indexed (messageLeaf, messageIndex)
      // Topic 0 is the event signature, Topic 1 is intentId
      // Data contains messageLeaf (32 bytes) + messageIndex (32 bytes)
      if (log.data && log.data.length >= 130) {
        // 0x + 64 + 64 = 130 chars
        try {
          // Parse messageLeaf from the first 32 bytes of data
          messageLeaf = `0x${log.data.slice(2, 66)}` as Hex;
          // Parse messageIndex from the second 32 bytes of data
          const messageIndexHex = `0x${log.data.slice(66, 130)}`;
          messageIndex = BigInt(messageIndexHex);
          logInfo(`Extracted L1→L2 message index: ${messageIndex}`);
          break;
        } catch {
          // Continue to next log if parsing fails
        }
      }
    }
  }

  // Debug: log all events from portal for troubleshooting
  if (messageIndex === 0n) {
    console.log("Warning: Could not extract message index. Portal logs:");
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === portalAddress.toLowerCase()) {
      }
    }
  }

  logSuccess(`Deposit executed (tx: ${txHash.slice(0, 10)}..., messageIndex: ${messageIndex})`);

  return { txHash, success: true, messageIndex, messageLeaf };
}

/**
 * Execute a withdraw intent on L1.
 *
 * This function:
 * 1. Consumes the L2→L1 message from the Aztec outbox
 * 2. Withdraws from Aave
 * 3. Deposits tokens to L2 via the token portal
 * 4. Sends an L1→L2 confirmation message
 *
 * @param publicClient - Viem public client for waiting on receipts
 * @param walletClient - Viem wallet client (relayer) for signing
 * @param portalAddress - AztecAavePortalL1 contract address
 * @param intent - The withdraw intent from L2
 * @param secretHash - Secret hash for L2 token claiming
 * @param proof - Merkle proof for L2→L1 message verification
 * @param abi - Optional custom ABI (defaults to PORTAL_ABI)
 * @returns Transaction result
 *
 * @example
 * ```ts
 * const result = await executeWithdraw(
 *   publicClient,
 *   relayerWallet,
 *   portalAddress,
 *   withdrawIntent,
 *   secretHash,
 *   { l2BlockNumber: 100n, leafIndex: 0n, siblingPath: [] }
 * );
 * ```
 */
export async function executeWithdraw(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain, Account>,
  portalAddress: Address,
  intent: WithdrawIntent,
  secretHash: Hex,
  proof: MerkleProof,
  abi: Abi = PORTAL_ABI as unknown as Abi
): Promise<ExecuteWithdrawResult> {
  logInfo(`Executing withdraw for intent ${intent.intentId.slice(0, 10)}...`);

  // Convert intent to the tuple format expected by the contract
  const intentTuple = {
    intentId: intent.intentId,
    ownerHash: intent.ownerHash,
    amount: intent.amount,
    deadline: intent.deadline,
  };

  const txHash = await walletClient.writeContract({
    address: portalAddress,
    abi,
    functionName: "executeWithdraw",
    args: [intentTuple, secretHash, proof.l2BlockNumber, proof.leafIndex, proof.siblingPath],
    gas: 5_000_000n,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  // Parse events from the transaction receipt
  let withdrawnAmount = intent.amount; // Default to requested amount
  let messageKey: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";
  let messageIndex = 0n;
  let messageLeaf: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

  // Event topic signatures (keccak256 of event signature)
  // WithdrawExecuted(bytes32 indexed,address indexed,uint256) - keccak256("WithdrawExecuted(bytes32,address,uint256)")
  const withdrawExecutedTopic =
    "0xf5fcca62037075195a3fc429e3478dcc6fc9e9d6b14fcd71cae6eeab97b20910";
  // TokensDepositedToL2(bytes32 indexed,bytes32,uint256) - keccak256("TokensDepositedToL2(bytes32,bytes32,uint256)")
  const tokensDepositedToL2Topic =
    "0x0227d4acbd7d255fe4ff206c94b800ab01abfc72e94c650ff7af246ee5208e0b";
  // L2MessageSent(bytes32 indexed,bytes32,uint256) - keccak256("L2MessageSent(bytes32,bytes32,uint256)")
  const l2MessageSentTopic = "0xda6a32d6995bf9aa269353dddbe234d0866298db111521e41d8a65ab4f6c96a7";

  // Debug: log all events
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === portalAddress.toLowerCase()) {
    }
  }

  for (const log of receipt.logs) {
    // Only look at logs from the portal contract
    if (log.address.toLowerCase() !== portalAddress.toLowerCase()) continue;
    if (!log.topics[0] || !log.data) continue;

    const eventTopic = log.topics[0].toLowerCase();

    if (eventTopic === withdrawExecutedTopic.toLowerCase() && log.data.length >= 66) {
      // WithdrawExecuted event - parse amount from data
      withdrawnAmount = BigInt(log.data.slice(0, 66));
      console.log(
        "[executeWithdraw] Parsed withdrawn amount from WithdrawExecuted:",
        withdrawnAmount.toString()
      );
    } else if (eventTopic === tokensDepositedToL2Topic.toLowerCase() && log.data.length >= 130) {
      // TokensDepositedToL2 event - parse messageKey from data (first 32 bytes)
      messageKey = `0x${log.data.slice(2, 66)}` as Hex;
    } else if (eventTopic === l2MessageSentTopic.toLowerCase() && log.data.length >= 130) {
      // L2MessageSent event - extract messageLeaf and messageIndex for L2 finalization
      messageLeaf = `0x${log.data.slice(2, 66)}` as Hex;
      messageIndex = BigInt(`0x${log.data.slice(66, 130)}`);
    }
  }

  logSuccess(
    `Withdraw executed (tx: ${txHash.slice(0, 10)}...), amount: ${withdrawnAmount}, messageIndex: ${messageIndex}`
  );

  return { txHash, success: true, withdrawnAmount, messageKey, messageIndex, messageLeaf };
}

// =============================================================================
// Query Functions
// =============================================================================

/**
 * Get the shares tracked for an intent.
 *
 * @param publicClient - Viem public client
 * @param portalAddress - Portal contract address
 * @param intentId - The intent ID to query
 * @param abi - Optional custom ABI
 * @returns Number of shares (aTokens) held for this intent
 */
export async function getIntentShares(
  publicClient: PublicClient<Transport, Chain>,
  portalAddress: Address,
  intentId: Hex,
  abi: Abi = PORTAL_ABI as unknown as Abi
): Promise<bigint> {
  const shares = await publicClient.readContract({
    address: portalAddress,
    abi,
    functionName: "getIntentShares",
    args: [intentId],
  });
  return shares as bigint;
}

/**
 * Get the asset address tracked for an intent.
 *
 * @param publicClient - Viem public client
 * @param portalAddress - Portal contract address
 * @param intentId - The intent ID to query
 * @param abi - Optional custom ABI
 * @returns Asset address or zero address if not found
 */
export async function getIntentAsset(
  publicClient: PublicClient<Transport, Chain>,
  portalAddress: Address,
  intentId: Hex,
  abi: Abi = PORTAL_ABI as unknown as Abi
): Promise<Address> {
  const asset = await publicClient.readContract({
    address: portalAddress,
    abi,
    functionName: "getIntentAsset",
    args: [intentId],
  });
  return asset as Address;
}

/**
 * Check if a deposit intent has already been consumed (executed).
 *
 * @param publicClient - Viem public client
 * @param portalAddress - Portal contract address
 * @param intentId - The intent ID to check
 * @param abi - Optional custom ABI
 * @returns True if the intent has been consumed
 */
export async function isDepositIntentConsumed(
  publicClient: PublicClient<Transport, Chain>,
  portalAddress: Address,
  intentId: Hex,
  abi: Abi = PORTAL_ABI as unknown as Abi
): Promise<boolean> {
  const consumed = await publicClient.readContract({
    address: portalAddress,
    abi,
    functionName: "consumedDepositIntents",
    args: [intentId],
  });
  return consumed as boolean;
}

/**
 * Check if a withdraw intent has already been consumed (executed).
 *
 * @param publicClient - Viem public client
 * @param portalAddress - Portal contract address
 * @param intentId - The intent ID to check
 * @param abi - Optional custom ABI
 * @returns True if the intent has been consumed
 */
export async function isWithdrawIntentConsumed(
  publicClient: PublicClient<Transport, Chain>,
  portalAddress: Address,
  intentId: Hex,
  abi: Abi = PORTAL_ABI as unknown as Abi
): Promise<boolean> {
  const consumed = await publicClient.readContract({
    address: portalAddress,
    abi,
    functionName: "consumedWithdrawIntents",
    args: [intentId],
  });
  return consumed as boolean;
}

/**
 * Get complete intent status including shares and consumption state.
 *
 * @param publicClient - Viem public client
 * @param portalAddress - Portal contract address
 * @param intentId - The intent ID to query
 * @param abi - Optional custom ABI
 * @returns Intent status with all tracked data
 */
export async function getIntentStatus(
  publicClient: PublicClient<Transport, Chain>,
  portalAddress: Address,
  intentId: Hex,
  abi: Abi = PORTAL_ABI as unknown as Abi
): Promise<{
  consumed: boolean;
  shares: bigint;
  asset: Address;
}> {
  const [consumed, shares, asset] = await Promise.all([
    isDepositIntentConsumed(publicClient, portalAddress, intentId, abi),
    getIntentShares(publicClient, portalAddress, intentId, abi),
    getIntentAsset(publicClient, portalAddress, intentId, abi),
  ]);

  return { consumed, shares, asset };
}

/**
 * Get the Aztec outbox address from the portal contract.
 *
 * @param publicClient - Viem public client
 * @param portalAddress - Portal contract address
 * @param abi - Optional custom ABI
 * @returns Aztec outbox address
 */
export async function getAztecOutbox(
  publicClient: PublicClient<Transport, Chain>,
  portalAddress: Address,
  abi: Abi = PORTAL_ABI as unknown as Abi
): Promise<Address> {
  const outbox = await publicClient.readContract({
    address: portalAddress,
    abi,
    functionName: "AZTEC_OUTBOX",
    args: [],
  });
  return outbox as Address;
}

// =============================================================================
// Transaction Polling
// =============================================================================

/**
 * Configuration for L1 transaction polling
 */
export interface L1TransactionPollingConfig {
  /** Maximum time to wait in milliseconds (default: 120000 = 2 min) */
  timeout?: number;
  /** Interval between polls in milliseconds (default: 1000 = 1 sec) */
  interval?: number;
  /** Number of confirmations required (default: 1) */
  confirmations?: number;
}

/**
 * L1 Transaction status result
 */
export interface L1TransactionStatus {
  /** Whether the transaction has been confirmed */
  confirmed: boolean;
  /** Transaction hash */
  txHash: Hex;
  /** Block number if confirmed */
  blockNumber?: bigint;
  /** Transaction status ("success" | "reverted") */
  status?: "success" | "reverted";
  /** Error message if failed */
  error?: string;
}

/**
 * Wait for an L1 transaction to be confirmed by polling for receipt.
 *
 * Use this when the wallet doesn't immediately report transaction status,
 * or when you need to poll for confirmation separately from the initial send.
 *
 * @param publicClient - Viem public client for reading chain state
 * @param txHash - Transaction hash to poll for
 * @param config - Polling configuration
 * @returns Transaction status with confirmation details
 *
 * @example
 * ```ts
 * const status = await waitForTransaction(publicClient, txHash, {
 *   timeout: 60000,
 *   confirmations: 2,
 * });
 * if (status.confirmed && status.status === "success") {
 *   console.log(`Confirmed in block ${status.blockNumber}`);
 * }
 * ```
 */
export async function waitForTransaction(
  publicClient: PublicClient<Transport, Chain>,
  txHash: Hex,
  config: L1TransactionPollingConfig = {}
): Promise<L1TransactionStatus> {
  const { timeout = 120000, interval = 1000, confirmations = 1 } = config;

  const startTime = Date.now();

  logInfo(`Polling for L1 transaction ${txHash.slice(0, 16)}...`);

  while (Date.now() - startTime < timeout) {
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: txHash });

      if (receipt) {
        // Check if we have enough confirmations
        const currentBlock = await publicClient.getBlockNumber();
        const txConfirmations = currentBlock - receipt.blockNumber + 1n;

        if (txConfirmations >= BigInt(confirmations)) {
          const status = receipt.status === "success" ? "success" : "reverted";

          if (status === "success") {
            logSuccess(`L1 transaction confirmed in block ${receipt.blockNumber}`);
          } else {
            logError(`L1 transaction reverted in block ${receipt.blockNumber}`);
          }

          return {
            confirmed: true,
            txHash,
            blockNumber: receipt.blockNumber,
            status,
          };
        }

        // Not enough confirmations yet, wait and retry
        await new Promise((resolve) => setTimeout(resolve, interval));
        continue;
      }

      // Receipt not found yet, wait and retry
      await new Promise((resolve) => setTimeout(resolve, interval));
    } catch {
      // Transaction not found or error, continue polling
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  // Timeout reached
  logError(`L1 transaction polling timed out after ${timeout}ms`);
  return {
    confirmed: false,
    txHash,
    error: `Polling timed out after ${timeout}ms`,
  };
}

// =============================================================================
// Deposit Event Lookup
// =============================================================================

/**
 * Recover the L1→L2 message data for a deposit intent that was already consumed.
 *
 * When `executeDeposit` was previously called successfully, the portal emits
 * `L2MessageSent(bytes32 indexed intentId, bytes32 messageLeaf, uint256 messageIndex)`.
 * This function queries that event to recover the data needed for L2 finalization.
 *
 * @param publicClient - Viem public client
 * @param portalAddress - Portal contract address
 * @param intentId - The intent ID to look up
 * @param fromBlock - Starting block to scan (default: 0)
 * @returns Message leaf and index if found, null otherwise
 */
export async function getDepositL2MessageSent(
  publicClient: PublicClient<Transport, Chain>,
  portalAddress: Address,
  intentId: Hex,
  fromBlock: bigint = 0n
): Promise<{ messageLeaf: Hex; messageIndex: bigint } | null> {
  try {
    const logs = await publicClient.getLogs({
      address: portalAddress,
      event: {
        type: "event",
        name: "L2MessageSent",
        inputs: [
          { name: "intentId", type: "bytes32", indexed: true },
          { name: "messageLeaf", type: "bytes32", indexed: false },
          { name: "messageIndex", type: "uint256", indexed: false },
        ],
      },
      args: {
        intentId: intentId,
      },
      fromBlock,
      toBlock: "latest",
    });

    if (logs.length > 0) {
      const latestLog = logs[logs.length - 1];
      return {
        messageLeaf: latestLog.args.messageLeaf as Hex,
        messageIndex: latestLog.args.messageIndex as bigint,
      };
    }

    return null;
  } catch (error) {
    console.warn("[getDepositL2MessageSent] Error querying events:", error);
    return null;
  }
}

// =============================================================================
// Withdrawal Bridge Lookup
// =============================================================================

/**
 * Get the bridge messageKey for a withdrawn position by querying L1 events.
 *
 * This queries TokensDepositedToL2 events filtered by intentId to find
 * the corresponding messageKey. This is needed to check if a withdrawal's
 * tokens have been claimed (by checking if the secret still exists).
 *
 * @param publicClient - Viem public client
 * @param portalAddress - Portal contract address
 * @param intentId - The intent ID (position ID) to look up
 * @param fromBlock - Starting block to scan (default: 0)
 * @returns The messageKey if found, null otherwise
 */
export async function getWithdrawalBridgeMessageKey(
  publicClient: PublicClient<Transport, Chain>,
  portalAddress: Address,
  intentId: Hex,
  fromBlock: bigint = 0n
): Promise<Hex | null> {
  try {
    const logs = await publicClient.getLogs({
      address: portalAddress,
      event: {
        type: "event",
        name: "TokensDepositedToL2",
        inputs: [
          { name: "intentId", type: "bytes32", indexed: true },
          { name: "messageKey", type: "bytes32", indexed: false },
          { name: "messageIndex", type: "uint256", indexed: false },
        ],
      },
      args: {
        intentId: intentId,
      },
      fromBlock,
      toBlock: "latest",
    });

    if (logs.length > 0) {
      // Return the most recent event's messageKey
      const latestLog = logs[logs.length - 1];
      return latestLog.args.messageKey as Hex;
    }

    return null;
  } catch (error) {
    console.warn("[getWithdrawalBridgeMessageKey] Error querying events:", error);
    return null;
  }
}

/**
 * Get the withdrawn amount for a withdrawal intent from L1 events.
 *
 * Queries the WithdrawExecuted event emitted by the portal during executeWithdraw.
 *
 * @param publicClient - Viem public client
 * @param portalAddress - Portal contract address
 * @param intentId - The intent ID to look up
 * @returns The withdrawn amount if found, null otherwise
 */
export async function getWithdrawnAmount(
  publicClient: PublicClient<Transport, Chain>,
  portalAddress: Address,
  intentId: Hex
): Promise<bigint | null> {
  try {
    const logs = await publicClient.getLogs({
      address: portalAddress,
      event: {
        type: "event",
        name: "WithdrawExecuted",
        inputs: [
          { name: "intentId", type: "bytes32", indexed: true },
          { name: "asset", type: "address", indexed: true },
          { name: "amount", type: "uint256", indexed: false },
        ],
      },
      args: { intentId },
      fromBlock: 0n,
      toBlock: "latest",
    });

    if (logs.length > 0) {
      const latestLog = logs[logs.length - 1];
      return latestLog.args.amount as bigint;
    }

    return null;
  } catch (error) {
    console.warn("[getWithdrawnAmount] Error querying events:", error);
    return null;
  }
}
