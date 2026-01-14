/**
 * L1 Token Operations Service
 *
 * ERC20 operations (mint, approve, transfer, balanceOf) for L1 tokens.
 * Matches the pattern from e2e/scripts/full-flow.ts:628-663.
 */

import {
  type PublicClient,
  type WalletClient,
  type Chain,
  type Transport,
  type Account,
  type Address,
  type Abi,
  type Hex,
} from "viem";
import { logInfo, logSuccess } from "../../store/logger.js";

// =============================================================================
// ERC20 ABI (minimal interface for token operations)
// =============================================================================

/**
 * Minimal ERC20 ABI for token operations.
 * Includes only the functions needed for the deposit/withdraw flow.
 */
export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "mint",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
] as const;

// =============================================================================
// Types
// =============================================================================

export interface TokenOperationResult {
  txHash: Hex;
  success: boolean;
}

// =============================================================================
// Read Operations
// =============================================================================

/**
 * Get the balance of an account for a specific token.
 *
 * @param publicClient - Viem public client
 * @param tokenAddress - ERC20 token contract address
 * @param account - Account to query balance for
 * @param abi - Optional custom ABI (defaults to ERC20_ABI)
 * @returns Token balance as bigint (returns 0n if contract not deployed)
 *
 * @example
 * ```ts
 * const balance = await balanceOf(publicClient, usdcAddress, userAddress);
 * ```
 */
export async function balanceOf(
  publicClient: PublicClient<Transport, Chain>,
  tokenAddress: Address,
  account: Address,
  abi: Abi = ERC20_ABI as unknown as Abi
): Promise<bigint> {
  try {
    const balance = await publicClient.readContract({
      address: tokenAddress,
      abi,
      functionName: "balanceOf",
      args: [account],
    });
    return balance as bigint;
  } catch {
    // Balance queries may return 0n before contracts are deployed
    return 0n;
  }
}

/**
 * Get the allowance granted by an owner to a spender.
 *
 * @param publicClient - Viem public client
 * @param tokenAddress - ERC20 token contract address
 * @param owner - Token owner address
 * @param spender - Approved spender address
 * @param abi - Optional custom ABI (defaults to ERC20_ABI)
 * @returns Allowance amount as bigint
 */
export async function allowance(
  publicClient: PublicClient<Transport, Chain>,
  tokenAddress: Address,
  owner: Address,
  spender: Address,
  abi: Abi = ERC20_ABI as unknown as Abi
): Promise<bigint> {
  try {
    const result = await publicClient.readContract({
      address: tokenAddress,
      abi,
      functionName: "allowance",
      args: [owner, spender],
    });
    return result as bigint;
  } catch {
    return 0n;
  }
}

/**
 * Get the token decimals.
 *
 * @param publicClient - Viem public client
 * @param tokenAddress - ERC20 token contract address
 * @param abi - Optional custom ABI (defaults to ERC20_ABI)
 * @returns Token decimals (defaults to 18 if query fails)
 */
export async function decimals(
  publicClient: PublicClient<Transport, Chain>,
  tokenAddress: Address,
  abi: Abi = ERC20_ABI as unknown as Abi
): Promise<number> {
  try {
    const result = await publicClient.readContract({
      address: tokenAddress,
      abi,
      functionName: "decimals",
      args: [],
    });
    return result as number;
  } catch {
    return 18;
  }
}

/**
 * Get the token symbol.
 *
 * @param publicClient - Viem public client
 * @param tokenAddress - ERC20 token contract address
 * @param abi - Optional custom ABI (defaults to ERC20_ABI)
 * @returns Token symbol (defaults to "UNKNOWN" if query fails)
 */
export async function symbol(
  publicClient: PublicClient<Transport, Chain>,
  tokenAddress: Address,
  abi: Abi = ERC20_ABI as unknown as Abi
): Promise<string> {
  try {
    const result = await publicClient.readContract({
      address: tokenAddress,
      abi,
      functionName: "symbol",
      args: [],
    });
    return result as string;
  } catch {
    return "UNKNOWN";
  }
}

// =============================================================================
// Write Operations
// =============================================================================

/**
 * Mint tokens to an address.
 * Only works with MockERC20 contracts that have a public mint function.
 *
 * @param publicClient - Viem public client for waiting on receipts
 * @param walletClient - Viem wallet client for signing
 * @param tokenAddress - ERC20 token contract address
 * @param to - Recipient address
 * @param amount - Amount to mint
 * @param abi - Optional custom ABI (defaults to ERC20_ABI)
 * @returns Transaction result
 *
 * @example
 * ```ts
 * const result = await mint(
 *   publicClient,
 *   deployerWallet,
 *   usdcAddress,
 *   userAddress,
 *   1000000n // 1 USDC with 6 decimals
 * );
 * ```
 */
export async function mint(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain, Account>,
  tokenAddress: Address,
  to: Address,
  amount: bigint,
  abi: Abi = ERC20_ABI as unknown as Abi
): Promise<TokenOperationResult> {
  logInfo(`Minting ${amount} tokens to ${to}...`);

  const txHash = await walletClient.writeContract({
    address: tokenAddress,
    abi,
    functionName: "mint",
    args: [to, amount],
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });

  logSuccess(`Minted tokens (tx: ${txHash.slice(0, 10)}...)`);

  return { txHash, success: true };
}

/**
 * Approve a spender to transfer tokens on behalf of the caller.
 *
 * Note: To prevent approval race conditions if user double-clicks,
 * consider checking existing allowance before approving or using
 * permit-based approvals where available.
 *
 * @param publicClient - Viem public client for waiting on receipts
 * @param walletClient - Viem wallet client for signing
 * @param tokenAddress - ERC20 token contract address
 * @param spender - Address to approve
 * @param amount - Amount to approve
 * @param abi - Optional custom ABI (defaults to ERC20_ABI)
 * @returns Transaction result
 *
 * @example
 * ```ts
 * const result = await approve(
 *   publicClient,
 *   userWallet,
 *   usdcAddress,
 *   portalAddress,
 *   depositAmount
 * );
 * ```
 */
export async function approve(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain, Account>,
  tokenAddress: Address,
  spender: Address,
  amount: bigint,
  abi: Abi = ERC20_ABI as unknown as Abi
): Promise<TokenOperationResult> {
  logInfo(`Approving ${spender.slice(0, 10)}... to spend ${amount} tokens...`);

  const txHash = await walletClient.writeContract({
    address: tokenAddress,
    abi,
    functionName: "approve",
    args: [spender, amount],
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });

  logSuccess(`Approved (tx: ${txHash.slice(0, 10)}...)`);

  return { txHash, success: true };
}

/**
 * Transfer tokens to an address.
 *
 * @param publicClient - Viem public client for waiting on receipts
 * @param walletClient - Viem wallet client for signing
 * @param tokenAddress - ERC20 token contract address
 * @param to - Recipient address
 * @param amount - Amount to transfer
 * @param abi - Optional custom ABI (defaults to ERC20_ABI)
 * @returns Transaction result
 *
 * @example
 * ```ts
 * const result = await transfer(
 *   publicClient,
 *   userWallet,
 *   usdcAddress,
 *   portalAddress,
 *   depositAmount
 * );
 * ```
 */
export async function transfer(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain, Account>,
  tokenAddress: Address,
  to: Address,
  amount: bigint,
  abi: Abi = ERC20_ABI as unknown as Abi
): Promise<TokenOperationResult> {
  logInfo(`Transferring ${amount} tokens to ${to.slice(0, 10)}...`);

  const txHash = await walletClient.writeContract({
    address: tokenAddress,
    abi,
    functionName: "transfer",
    args: [to, amount],
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });

  logSuccess(`Transfer complete (tx: ${txHash.slice(0, 10)}...)`);

  return { txHash, success: true };
}

// =============================================================================
// Bulk Balance Queries
// =============================================================================

/**
 * Balance information for a single address
 */
export interface AddressBalances {
  usdc: bigint;
  aToken: bigint;
}

/**
 * Complete balance snapshot for all relevant addresses
 */
export interface AllBalances {
  user: AddressBalances;
  portal: AddressBalances;
  lendingPool: AddressBalances;
}

/**
 * L1 addresses required for balance queries
 */
export interface L1AddressesForBalances {
  portal: Address;
  mockUsdc: Address;
  mockAToken: Address;
  mockLendingPool: Address;
}

/**
 * Get all balances for user, portal, and lending pool.
 * Matches getAllBalances from e2e/scripts/full-flow.ts:136-199.
 *
 * @param publicClient - Viem public client
 * @param addresses - L1 contract addresses
 * @param userAddress - Optional user address to query
 * @param abi - Optional custom ABI (defaults to ERC20_ABI)
 * @returns Balance snapshot for all addresses
 *
 * @example
 * ```ts
 * const balances = await getAllBalances(
 *   publicClient,
 *   l1Addresses,
 *   userAddress
 * );
 * console.log(`User USDC: ${balances.user.usdc}`);
 * ```
 */
export async function getAllBalances(
  publicClient: PublicClient<Transport, Chain>,
  addresses: L1AddressesForBalances,
  userAddress?: Address,
  abi: Abi = ERC20_ABI as unknown as Abi
): Promise<AllBalances> {
  const queries: Promise<bigint>[] = [
    // Portal balances
    balanceOf(publicClient, addresses.mockUsdc, addresses.portal, abi),
    balanceOf(publicClient, addresses.mockAToken, addresses.portal, abi),
    // Lending pool balances
    balanceOf(publicClient, addresses.mockUsdc, addresses.mockLendingPool, abi),
    balanceOf(publicClient, addresses.mockAToken, addresses.mockLendingPool, abi),
  ];

  // Add user balance queries if user address provided
  if (userAddress) {
    queries.push(
      balanceOf(publicClient, addresses.mockUsdc, userAddress, abi),
      balanceOf(publicClient, addresses.mockAToken, userAddress, abi)
    );
  }

  const results = await Promise.all(queries);
  const [portalUsdc, portalAToken, poolUsdc, poolAToken, userUsdc, userAToken] = results;

  return {
    user: { usdc: userUsdc ?? 0n, aToken: userAToken ?? 0n },
    portal: { usdc: portalUsdc, aToken: portalAToken },
    lendingPool: { usdc: poolUsdc, aToken: poolAToken },
  };
}

// =============================================================================
// Formatting Helpers
// =============================================================================

/**
 * Format a token balance for display.
 * Converts from base units to human-readable format.
 *
 * @param balance - Balance in base units (e.g., wei or smallest unit)
 * @param tokenDecimals - Number of decimals for the token (default: 6 for USDC)
 * @returns Formatted string (e.g., "1,000.00")
 */
export function formatBalance(balance: bigint, tokenDecimals: number = 6): string {
  const divisor = 10n ** BigInt(tokenDecimals);
  const wholePart = balance / divisor;
  const fractionalPart = balance % divisor;

  // Pad fractional part with leading zeros
  const fractionalStr = fractionalPart.toString().padStart(tokenDecimals, "0");

  // Format whole part with commas
  const wholeStr = wholePart.toLocaleString("en-US");

  // Trim trailing zeros from fractional part, but keep at least 2 digits
  const trimmedFractional = fractionalStr.replace(/0+$/, "") || "00";
  const displayFractional = trimmedFractional.padEnd(2, "0").slice(0, 2);

  return `${wholeStr}.${displayFractional}`;
}

/**
 * Parse a human-readable balance string to base units.
 *
 * @param value - Human-readable value (e.g., "100.50")
 * @param tokenDecimals - Number of decimals for the token (default: 6 for USDC)
 * @returns Balance in base units as bigint
 */
export function parseBalance(value: string, tokenDecimals: number = 6): bigint {
  // Remove commas and whitespace
  const cleaned = value.replace(/,/g, "").trim();

  // Split on decimal point
  const [whole, fractional = ""] = cleaned.split(".");

  // Pad or truncate fractional part to match decimals
  const paddedFractional = fractional.padEnd(tokenDecimals, "0").slice(0, tokenDecimals);

  // Combine and parse
  const combined = whole + paddedFractional;
  return BigInt(combined);
}
