/**
 * L1 TokenPortal Service
 *
 * TokenPortal contract interaction functions for bridging tokens from L1 to L2.
 * TokenPortal locks tokens on L1 when depositing to Aztec L2 and releases when withdrawing.
 *
 * Flow: L1 USDC -> TokenPortal.depositToAztecPrivate -> L1->L2 message -> L2 BridgedToken claim
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
import { logInfo, logSuccess } from "../../store/logger.js";

// =============================================================================
// TokenPortal ABI (minimal interface for deposit operations)
// =============================================================================

/**
 * Minimal ABI for TokenPortal contract.
 * Includes only the functions needed for bridging tokens from L1 to L2.
 */
export const TOKEN_PORTAL_ABI = [
  // depositToAztecPrivate - private L2 deposit (no visible recipient)
  {
    type: "function",
    name: "depositToAztecPrivate",
    inputs: [
      { name: "_amount", type: "uint256" },
      { name: "_secretHashForL2MessageConsumption", type: "bytes32" },
    ],
    outputs: [
      { name: "messageKey", type: "bytes32" },
      { name: "messageIndex", type: "uint256" },
    ],
    stateMutability: "nonpayable",
  },
  // depositToAztecPublic - public L2 deposit (visible recipient)
  {
    type: "function",
    name: "depositToAztecPublic",
    inputs: [
      { name: "_to", type: "bytes32" },
      { name: "_amount", type: "uint256" },
      { name: "_secretHash", type: "bytes32" },
    ],
    outputs: [
      { name: "messageKey", type: "bytes32" },
      { name: "messageIndex", type: "uint256" },
    ],
    stateMutability: "nonpayable",
  },
  // underlying - get the ERC20 token address
  {
    type: "function",
    name: "underlying",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  // Events
  {
    type: "event",
    name: "DepositToAztecPrivate",
    inputs: [
      { name: "amount", type: "uint256", indexed: false },
      { name: "secretHash", type: "bytes32", indexed: false },
      { name: "messageKey", type: "bytes32", indexed: false },
      { name: "messageIndex", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DepositToAztecPublic",
    inputs: [
      { name: "to", type: "bytes32", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "secretHash", type: "bytes32", indexed: false },
      { name: "messageKey", type: "bytes32", indexed: false },
      { name: "messageIndex", type: "uint256", indexed: false },
    ],
  },
] as const;

// =============================================================================
// Types
// =============================================================================

/**
 * Result of a depositToAztecPrivate call
 */
export interface DepositToAztecPrivateResult {
  /** Transaction hash */
  txHash: Hex;
  /** Whether the transaction succeeded */
  success: boolean;
  /** Message key for L1->L2 message tracking */
  messageKey: Hex;
  /** Message index in the L2 message tree */
  messageIndex: bigint;
}

/**
 * Result of a depositToAztecPublic call
 */
export interface DepositToAztecPublicResult {
  /** Transaction hash */
  txHash: Hex;
  /** Whether the transaction succeeded */
  success: boolean;
  /** Message key for L1->L2 message tracking */
  messageKey: Hex;
  /** Message index in the L2 message tree */
  messageIndex: bigint;
}

// =============================================================================
// Deposit Functions
// =============================================================================

/**
 * Deposit tokens to a private Aztec L2 balance.
 *
 * This function:
 * 1. Locks tokens in the TokenPortal on L1
 * 2. Sends an L1->L2 message for private token claiming
 * 3. The recipient claims on L2 using the secret preimage
 *
 * Note: Caller must have approved the TokenPortal to spend their tokens first.
 *
 * @param publicClient - Viem public client for waiting on receipts
 * @param walletClient - Viem wallet client for signing
 * @param tokenPortalAddress - TokenPortal contract address
 * @param amount - Amount of tokens to deposit (in token decimals)
 * @param secretHash - Hash of the secret for L2 claiming (bytes32)
 * @param abi - Optional custom ABI (defaults to TOKEN_PORTAL_ABI)
 * @returns Transaction result with message key and index
 *
 * @example
 * ```ts
 * // First approve the TokenPortal
 * await approve(publicClient, userWallet, usdcAddress, tokenPortalAddress, amount);
 *
 * // Then deposit to private L2 balance
 * const result = await depositToAztecPrivate(
 *   publicClient,
 *   userWallet,
 *   tokenPortalAddress,
 *   1000000n, // 1 USDC
 *   secretHash // 32-byte hash of claiming secret
 * );
 * ```
 */
export async function depositToAztecPrivate(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain, Account>,
  tokenPortalAddress: Address,
  amount: bigint,
  secretHash: Hex,
  abi: Abi = TOKEN_PORTAL_ABI as unknown as Abi
): Promise<DepositToAztecPrivateResult> {
  logInfo(`Depositing ${amount} tokens to Aztec L2 (private)...`);

  const txHash = await walletClient.writeContract({
    address: tokenPortalAddress,
    abi,
    functionName: "depositToAztecPrivate",
    args: [amount, secretHash],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  // Parse the DepositToAztecPrivate event to extract messageKey and messageIndex
  let messageKey: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";
  let messageIndex = 0n;

  // Find the DepositToAztecPrivate event in logs
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === tokenPortalAddress.toLowerCase()) {
      // DepositToAztecPrivate has no indexed params
      // Data contains: amount (32) + secretHash (32) + messageKey (32) + messageIndex (32) = 128 bytes
      if (log.data && log.data.length >= 258) {
        // 0x + 256 chars = 258
        try {
          // Extract messageKey (bytes 64-96 of data, after amount and secretHash)
          messageKey = `0x${log.data.slice(130, 194)}` as Hex;
          // Extract messageIndex (bytes 96-128 of data)
          const messageIndexHex = `0x${log.data.slice(194, 258)}`;
          messageIndex = BigInt(messageIndexHex);
          break;
        } catch {
          // Continue if parsing fails
        }
      }
    }
  }

  logSuccess(
    `Deposit to L2 complete (tx: ${txHash.slice(0, 10)}..., messageIndex: ${messageIndex})`
  );

  return { txHash, success: true, messageKey, messageIndex };
}

/**
 * Deposit tokens to a public Aztec L2 balance.
 *
 * This function:
 * 1. Locks tokens in the TokenPortal on L1
 * 2. Sends an L1->L2 message with a visible recipient
 * 3. The recipient claims on L2 using the secret preimage
 *
 * Note: Caller must have approved the TokenPortal to spend their tokens first.
 *
 * @param publicClient - Viem public client for waiting on receipts
 * @param walletClient - Viem wallet client for signing
 * @param tokenPortalAddress - TokenPortal contract address
 * @param to - Recipient address on L2 (as bytes32)
 * @param amount - Amount of tokens to deposit (in token decimals)
 * @param secretHash - Hash of the secret for L2 claiming (bytes32)
 * @param abi - Optional custom ABI (defaults to TOKEN_PORTAL_ABI)
 * @returns Transaction result with message key and index
 */
export async function depositToAztecPublic(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain, Account>,
  tokenPortalAddress: Address,
  to: Hex,
  amount: bigint,
  secretHash: Hex,
  abi: Abi = TOKEN_PORTAL_ABI as unknown as Abi
): Promise<DepositToAztecPublicResult> {
  logInfo(`Depositing ${amount} tokens to Aztec L2 (public) for ${to.slice(0, 18)}...`);

  const txHash = await walletClient.writeContract({
    address: tokenPortalAddress,
    abi,
    functionName: "depositToAztecPublic",
    args: [to, amount, secretHash],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  // Parse the DepositToAztecPublic event to extract messageKey and messageIndex
  let messageKey: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";
  let messageIndex = 0n;

  // Find the DepositToAztecPublic event in logs
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === tokenPortalAddress.toLowerCase()) {
      // DepositToAztecPublic has 1 indexed param (to), non-indexed: amount, secretHash, messageKey, messageIndex
      if (log.data && log.data.length >= 258) {
        try {
          // Data layout: amount (32) + secretHash (32) + messageKey (32) + messageIndex (32)
          messageKey = `0x${log.data.slice(130, 194)}` as Hex;
          const messageIndexHex = `0x${log.data.slice(194, 258)}`;
          messageIndex = BigInt(messageIndexHex);
          break;
        } catch {
          // Continue if parsing fails
        }
      }
    }
  }

  logSuccess(
    `Deposit to L2 complete (tx: ${txHash.slice(0, 10)}..., messageIndex: ${messageIndex})`
  );

  return { txHash, success: true, messageKey, messageIndex };
}

// =============================================================================
// Query Functions
// =============================================================================

/**
 * Get the underlying ERC20 token address for this TokenPortal.
 *
 * @param publicClient - Viem public client
 * @param tokenPortalAddress - TokenPortal contract address
 * @param abi - Optional custom ABI (defaults to TOKEN_PORTAL_ABI)
 * @returns The underlying token address
 */
export async function getUnderlyingToken(
  publicClient: PublicClient<Transport, Chain>,
  tokenPortalAddress: Address,
  abi: Abi = TOKEN_PORTAL_ABI as unknown as Abi
): Promise<Address> {
  const underlying = await publicClient.readContract({
    address: tokenPortalAddress,
    abi,
    functionName: "underlying",
    args: [],
  });
  return underlying as Address;
}

/**
 * Get the balance of tokens locked in the TokenPortal.
 *
 * This queries the ERC20 balance of the TokenPortal contract,
 * representing the total tokens locked for L2 bridging.
 *
 * @param publicClient - Viem public client
 * @param tokenPortalAddress - TokenPortal contract address
 * @param tokenAddress - ERC20 token address to query balance for
 * @returns Token balance locked in the portal
 */
export async function getPortalBalance(
  publicClient: PublicClient<Transport, Chain>,
  tokenPortalAddress: Address,
  tokenAddress: Address
): Promise<bigint> {
  // Use the ERC20 balanceOf function
  const ERC20_BALANCE_ABI = [
    {
      type: "function",
      name: "balanceOf",
      inputs: [{ name: "account", type: "address" }],
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
    },
  ] as const;

  try {
    const balance = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_BALANCE_ABI,
      functionName: "balanceOf",
      args: [tokenPortalAddress],
    });
    return balance as bigint;
  } catch {
    return 0n;
  }
}
