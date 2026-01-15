/**
 * L1 Portal Execution Service
 *
 * Portal contract interaction functions for executing deposits and withdrawals.
 * Matches the pattern from e2e/scripts/full-flow.ts:720-728.
 */

import type {
  Abi,
  Account,
  Address,
  Chain,
  Hex,
  PublicClient,
  Transport,
  WalletClient,
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
    name: "aztecOutbox",
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
    name: "consumedIntents",
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
}

/**
 * Result of an executeWithdraw call
 */
export interface ExecuteWithdrawResult {
  txHash: Hex;
  success: boolean;
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
  };

  const txHash = await walletClient.writeContract({
    address: portalAddress,
    abi,
    functionName: "executeDeposit",
    args: [intentTuple, proof.l2BlockNumber, proof.leafIndex, proof.siblingPath],
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });

  logSuccess(`Deposit executed (tx: ${txHash.slice(0, 10)}...)`);

  return { txHash, success: true };
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
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });

  logSuccess(`Withdraw executed (tx: ${txHash.slice(0, 10)}...)`);

  return { txHash, success: true };
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
 * Check if an intent has already been consumed (executed).
 *
 * @param publicClient - Viem public client
 * @param portalAddress - Portal contract address
 * @param intentId - The intent ID to check
 * @param abi - Optional custom ABI
 * @returns True if the intent has been consumed
 */
export async function isIntentConsumed(
  publicClient: PublicClient<Transport, Chain>,
  portalAddress: Address,
  intentId: Hex,
  abi: Abi = PORTAL_ABI as unknown as Abi
): Promise<boolean> {
  const consumed = await publicClient.readContract({
    address: portalAddress,
    abi,
    functionName: "consumedIntents",
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
    isIntentConsumed(publicClient, portalAddress, intentId, abi),
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
    functionName: "aztecOutbox",
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
