/**
 * L1 Token Faucet Service
 *
 * Provides rate-limited token claiming from the TokenFaucet contract.
 * Wraps the claim() and canClaim() functions for frontend consumption.
 */

import type {
  Account,
  Address,
  Chain,
  Hex,
  PublicClient,
  Transport,
  WalletClient,
} from "viem";
import { logInfo, logSuccess, logWarning } from "../../store/logger.js";

// =============================================================================
// TokenFaucet ABI (minimal interface for faucet operations)
// =============================================================================

/**
 * Minimal ABI for TokenFaucet contract.
 * Includes only the functions needed for claiming tokens and checking status.
 */
export const TOKEN_FAUCET_ABI = [
  // Read-only configuration
  {
    type: "function",
    name: "token",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "dripAmount",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "cooldownPeriod",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "lastClaimTime",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  // Check claim eligibility
  {
    type: "function",
    name: "canClaim",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      { name: "claimable", type: "bool" },
      { name: "remainingCooldown", type: "uint256" },
    ],
    stateMutability: "view",
  },
  // Claim tokens
  {
    type: "function",
    name: "claim",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // Events
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { name: "recipient", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

// =============================================================================
// Types
// =============================================================================

/**
 * Faucet configuration from contract
 */
export interface FaucetConfig {
  /** Token address dispensed by this faucet */
  token: Address;
  /** Amount of tokens per claim (in smallest unit) */
  dripAmount: bigint;
  /** Cooldown period between claims (in seconds) */
  cooldownPeriod: bigint;
}

/**
 * Claim eligibility status
 */
export interface ClaimStatus {
  /** Whether the account can claim now */
  claimable: boolean;
  /** Seconds remaining until next claim (0 if claimable) */
  remainingCooldown: bigint;
  /** Timestamp of last claim (0 if never claimed) */
  lastClaimTime: bigint;
}

/**
 * Result of a claim transaction
 */
export interface ClaimResult {
  txHash: Hex;
  success: boolean;
  /** Amount of tokens received */
  amount: bigint;
}

// =============================================================================
// Read Operations
// =============================================================================

/**
 * Get the faucet configuration (token, drip amount, cooldown).
 *
 * @param publicClient - Viem public client
 * @param faucetAddress - TokenFaucet contract address
 * @returns Faucet configuration
 *
 * @example
 * ```ts
 * const config = await getFaucetConfig(publicClient, faucetAddress);
 * console.log(`Drip: ${config.dripAmount}, Cooldown: ${config.cooldownPeriod}s`);
 * ```
 */
export async function getFaucetConfig(
  publicClient: PublicClient<Transport, Chain>,
  faucetAddress: Address
): Promise<FaucetConfig> {
  const [token, dripAmount, cooldownPeriod] = await Promise.all([
    publicClient.readContract({
      address: faucetAddress,
      abi: TOKEN_FAUCET_ABI,
      functionName: "token",
    }),
    publicClient.readContract({
      address: faucetAddress,
      abi: TOKEN_FAUCET_ABI,
      functionName: "dripAmount",
    }),
    publicClient.readContract({
      address: faucetAddress,
      abi: TOKEN_FAUCET_ABI,
      functionName: "cooldownPeriod",
    }),
  ]);

  return {
    token: token as Address,
    dripAmount: dripAmount as bigint,
    cooldownPeriod: cooldownPeriod as bigint,
  };
}

/**
 * Check if an account can claim tokens and get cooldown status.
 *
 * @param publicClient - Viem public client
 * @param faucetAddress - TokenFaucet contract address
 * @param account - Account to check eligibility for
 * @returns Claim eligibility status
 *
 * @example
 * ```ts
 * const status = await getClaimStatus(publicClient, faucetAddress, userAddress);
 * if (status.claimable) {
 *   console.log("Ready to claim!");
 * } else {
 *   console.log(`Wait ${status.remainingCooldown}s`);
 * }
 * ```
 */
export async function getClaimStatus(
  publicClient: PublicClient<Transport, Chain>,
  faucetAddress: Address,
  account: Address
): Promise<ClaimStatus> {
  const [[claimable, remainingCooldown], lastClaimTime] = await Promise.all([
    publicClient.readContract({
      address: faucetAddress,
      abi: TOKEN_FAUCET_ABI,
      functionName: "canClaim",
      args: [account],
    }) as Promise<[boolean, bigint]>,
    publicClient.readContract({
      address: faucetAddress,
      abi: TOKEN_FAUCET_ABI,
      functionName: "lastClaimTime",
      args: [account],
    }) as Promise<bigint>,
  ]);

  return {
    claimable,
    remainingCooldown,
    lastClaimTime,
  };
}

/**
 * Get the drip amount from the faucet.
 *
 * @param publicClient - Viem public client
 * @param faucetAddress - TokenFaucet contract address
 * @returns Drip amount in token's smallest unit
 */
export async function getDripAmount(
  publicClient: PublicClient<Transport, Chain>,
  faucetAddress: Address
): Promise<bigint> {
  const amount = await publicClient.readContract({
    address: faucetAddress,
    abi: TOKEN_FAUCET_ABI,
    functionName: "dripAmount",
  });
  return amount as bigint;
}

/**
 * Get the cooldown period from the faucet.
 *
 * @param publicClient - Viem public client
 * @param faucetAddress - TokenFaucet contract address
 * @returns Cooldown period in seconds
 */
export async function getCooldownPeriod(
  publicClient: PublicClient<Transport, Chain>,
  faucetAddress: Address
): Promise<bigint> {
  const period = await publicClient.readContract({
    address: faucetAddress,
    abi: TOKEN_FAUCET_ABI,
    functionName: "cooldownPeriod",
  });
  return period as bigint;
}

// =============================================================================
// Write Operations
// =============================================================================

/**
 * Claim tokens from the faucet.
 *
 * This function mints `dripAmount` tokens to the caller's address
 * if the cooldown period has expired.
 *
 * @param publicClient - Viem public client for waiting on receipts
 * @param walletClient - Viem wallet client for signing
 * @param faucetAddress - TokenFaucet contract address
 * @returns Claim result with transaction hash and amount
 * @throws Error if cooldown has not expired
 *
 * @example
 * ```ts
 * const result = await claim(publicClient, walletClient, faucetAddress);
 * console.log(`Claimed ${result.amount} tokens (tx: ${result.txHash})`);
 * ```
 */
export async function claim(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain, Account>,
  faucetAddress: Address
): Promise<ClaimResult> {
  const userAddress = walletClient.account.address;
  logInfo(`Claiming tokens from faucet for ${userAddress.slice(0, 10)}...`);

  // Check eligibility first for better error message
  const status = await getClaimStatus(publicClient, faucetAddress, userAddress);
  if (!status.claimable) {
    const message = `Cannot claim yet. ${status.remainingCooldown}s remaining in cooldown.`;
    logWarning(message);
    throw new Error(message);
  }

  // Get drip amount for logging
  const dripAmount = await getDripAmount(publicClient, faucetAddress);

  const txHash = await walletClient.writeContract({
    address: faucetAddress,
    abi: TOKEN_FAUCET_ABI,
    functionName: "claim",
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });

  logSuccess(`Claimed ${dripAmount} tokens (tx: ${txHash.slice(0, 10)}...)`);

  return {
    txHash,
    success: true,
    amount: dripAmount,
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Format remaining cooldown time for display.
 *
 * @param seconds - Cooldown remaining in seconds
 * @returns Human-readable string (e.g., "2m 30s" or "Ready")
 */
export function formatCooldown(seconds: bigint): string {
  if (seconds <= 0n) {
    return "Ready";
  }

  const totalSeconds = Number(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

/**
 * Calculate when the next claim will be available.
 *
 * @param lastClaimTime - Timestamp of last claim (Unix seconds)
 * @param cooldownPeriod - Cooldown duration in seconds
 * @returns Date when next claim is available
 */
export function getNextClaimTime(lastClaimTime: bigint, cooldownPeriod: bigint): Date {
  const nextClaimTimestamp = Number(lastClaimTime + cooldownPeriod) * 1000;
  return new Date(nextClaimTimestamp);
}
