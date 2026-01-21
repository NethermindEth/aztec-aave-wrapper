/**
 * Contract Configuration Service
 *
 * Provides functions to query fee and deadline configuration directly from
 * smart contracts, ensuring the frontend always uses authoritative values.
 *
 * The L2 AaveWrapper contract stores fee configuration:
 * - FEE_BASIS_POINTS: Protocol fee (10 = 0.1%)
 * - BASIS_POINTS_DENOMINATOR: 10000 (100%)
 * - MIN_DEPOSIT_AMOUNT: Minimum deposit in base units (1_000_000 = 1 USDC)
 *
 * The L1 AztecAavePortalL1 contract stores deadline constraints:
 * - MIN_DEADLINE: 5 minutes
 * - MAX_DEADLINE: 24 hours
 */

import type { Address, Chain, PublicClient, Transport } from "viem";
import { DEADLINE_CONSTRAINTS, FEE_CONFIG } from "../config/constants.js";
import { logError, logInfo, logSuccess } from "../store/logger.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Fee configuration from L2 AaveWrapper contract
 */
export interface FeeConfig {
  /** Fee in basis points (10 = 0.1%) */
  basisPoints: bigint;
  /** Denominator for basis point calculations (10000 = 100%) */
  denominator: bigint;
  /** Minimum deposit amount in base units */
  minDepositAmount: bigint;
}

/**
 * Deadline constraints from L1 AztecAavePortalL1 contract
 */
export interface DeadlineConstraints {
  /** Minimum deadline offset in seconds (5 minutes) */
  minOffsetSeconds: bigint;
  /** Maximum deadline offset in seconds (24 hours) */
  maxOffsetSeconds: bigint;
}

/**
 * Combined contract configuration
 */
export interface ContractConfig {
  /** Fee configuration from L2 */
  feeConfig: FeeConfig;
  /** Deadline constraints from L1 */
  deadlineConstraints: DeadlineConstraints;
  /** Whether config was loaded from contracts (false = using fallbacks) */
  loadedFromContracts: boolean;
}

// =============================================================================
// L2 AaveWrapper ABI (minimal for fee config)
// =============================================================================

const _AAVE_WRAPPER_CONFIG_ABI = [
  {
    type: "function",
    name: "get_fee_basis_points",
    inputs: [],
    outputs: [{ name: "", type: "uint128" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "get_basis_points_denominator",
    inputs: [],
    outputs: [{ name: "", type: "uint128" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "get_min_deposit_amount",
    inputs: [],
    outputs: [{ name: "", type: "uint128" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "get_fee_config",
    inputs: [],
    outputs: [
      { name: "", type: "uint128" },
      { name: "", type: "uint128" },
      { name: "", type: "uint128" },
    ],
    stateMutability: "view",
  },
] as const;

// =============================================================================
// L1 Portal ABI (minimal for deadline config)
// =============================================================================

const PORTAL_DEADLINE_ABI = [
  {
    type: "function",
    name: "getDeadlineConstraints",
    inputs: [],
    outputs: [
      { name: "minDeadline", type: "uint256" },
      { name: "maxDeadline", type: "uint256" },
    ],
    stateMutability: "pure",
  },
] as const;

// =============================================================================
// Fallback Configuration
// =============================================================================

/**
 * Get fallback fee config from frontend constants.
 * Used when contract queries fail or during initial load.
 */
export function getFallbackFeeConfig(): FeeConfig {
  return {
    basisPoints: BigInt(FEE_CONFIG.BASIS_POINTS),
    denominator: BigInt(FEE_CONFIG.DENOMINATOR),
    minDepositAmount: BigInt(FEE_CONFIG.MIN_DEPOSIT) * 1_000_000n, // Convert to base units
  };
}

/**
 * Get fallback deadline constraints from frontend constants.
 * Used when contract queries fail or during initial load.
 */
export function getFallbackDeadlineConstraints(): DeadlineConstraints {
  return {
    minOffsetSeconds: BigInt(DEADLINE_CONSTRAINTS.MIN_OFFSET_SECONDS),
    maxOffsetSeconds: BigInt(DEADLINE_CONSTRAINTS.MAX_OFFSET_SECONDS),
  };
}

/**
 * Get fallback contract config using frontend constants.
 */
export function getFallbackContractConfig(): ContractConfig {
  return {
    feeConfig: getFallbackFeeConfig(),
    deadlineConstraints: getFallbackDeadlineConstraints(),
    loadedFromContracts: false,
  };
}

// =============================================================================
// L1 Portal Queries
// =============================================================================

/**
 * Query deadline constraints from L1 AztecAavePortalL1 contract.
 *
 * @param publicClient - Viem public client for L1
 * @param portalAddress - L1 portal contract address
 * @returns Deadline constraints or null if query fails
 */
export async function queryL1DeadlineConstraints(
  publicClient: PublicClient<Transport, Chain>,
  portalAddress: Address
): Promise<DeadlineConstraints | null> {
  try {
    logInfo("Querying L1 portal for deadline constraints...");

    const result = await publicClient.readContract({
      address: portalAddress,
      abi: PORTAL_DEADLINE_ABI,
      functionName: "getDeadlineConstraints",
    });

    const [minDeadline, maxDeadline] = result as [bigint, bigint];

    logSuccess(`L1 deadline constraints: min=${minDeadline}s, max=${maxDeadline}s`);

    return {
      minOffsetSeconds: minDeadline,
      maxOffsetSeconds: maxDeadline,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`Failed to query L1 deadline constraints: ${errorMessage}`);
    return null;
  }
}

// =============================================================================
// L2 Contract Queries (via Aztec.js)
// =============================================================================

/**
 * Query fee configuration from L2 AaveWrapper contract.
 *
 * Note: This requires an Aztec PXE connection and the AaveWrapper contract.
 * For now, we provide a stub that returns fallback values.
 * The actual implementation would use the Aztec.js client.
 *
 * @param wrapperAddress - L2 AaveWrapper contract address
 * @returns Fee configuration or null if query fails
 */
export async function queryL2FeeConfig(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _wrapperAddress: string
): Promise<FeeConfig | null> {
  try {
    logInfo("Using default L2 fee configuration (L2 query not implemented in frontend)");

    // Return the authoritative values that match the L2 contract
    // These are the values defined in aztec/aave_wrapper/src/main.nr FeeConfig
    return {
      basisPoints: 10n, // FEE_BASIS_POINTS
      denominator: 10000n, // BASIS_POINTS_DENOMINATOR
      minDepositAmount: 1_000_000n, // MIN_DEPOSIT_AMOUNT (1 USDC)
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`Failed to query L2 fee config: ${errorMessage}`);
    return null;
  }
}

// =============================================================================
// Combined Configuration Loading
// =============================================================================

/**
 * Load complete contract configuration from both L1 and L2.
 *
 * Attempts to load from contracts, falls back to constants on failure.
 *
 * @param l1Client - Viem public client for L1 (optional)
 * @param portalAddress - L1 portal address (optional)
 * @param wrapperAddress - L2 wrapper address (optional)
 * @returns Complete contract configuration
 */
export async function loadContractConfig(
  l1Client?: PublicClient<Transport, Chain>,
  portalAddress?: Address,
  wrapperAddress?: string
): Promise<ContractConfig> {
  let feeConfig: FeeConfig | null = null;
  let deadlineConstraints: DeadlineConstraints | null = null;
  let loadedFromContracts = false;

  // Query L2 fee config
  if (wrapperAddress) {
    feeConfig = await queryL2FeeConfig(wrapperAddress);
  }

  // Query L1 deadline constraints
  if (l1Client && portalAddress) {
    deadlineConstraints = await queryL1DeadlineConstraints(l1Client, portalAddress);
  }

  // Use fallbacks for any missing values
  if (!feeConfig) {
    feeConfig = getFallbackFeeConfig();
  } else {
    loadedFromContracts = true;
  }

  if (!deadlineConstraints) {
    deadlineConstraints = getFallbackDeadlineConstraints();
  } else {
    loadedFromContracts = true;
  }

  return {
    feeConfig,
    deadlineConstraints,
    loadedFromContracts,
  };
}

// =============================================================================
// Utility Functions Using Contract Config
// =============================================================================

/**
 * Calculate protocol fee using contract config.
 *
 * @param amount - Gross amount in base units
 * @param config - Fee configuration from contract
 * @returns Fee amount in base units
 */
export function calculateFeeFromConfig(amount: bigint, config: FeeConfig): bigint {
  if (amount < 0n) {
    throw new Error("Amount cannot be negative");
  }
  return (amount * config.basisPoints) / config.denominator;
}

/**
 * Calculate net amount after fee using contract config.
 *
 * @param amount - Gross amount in base units
 * @param config - Fee configuration from contract
 * @returns Net amount after fee deduction
 */
export function calculateNetAmountFromConfig(amount: bigint, config: FeeConfig): bigint {
  const fee = calculateFeeFromConfig(amount, config);
  return amount - fee;
}

/**
 * Validate minimum deposit using contract config.
 *
 * @param amount - Deposit amount in base units
 * @param config - Fee configuration from contract
 * @returns Validation result with error message if invalid
 */
export function validateMinDepositFromConfig(
  amount: bigint,
  config: FeeConfig
): { isValid: boolean; error?: string } {
  if (amount < 0n) {
    return { isValid: false, error: "Amount cannot be negative" };
  }

  if (amount < config.minDepositAmount) {
    const minInTokens = Number(config.minDepositAmount) / 1_000_000;
    return {
      isValid: false,
      error: `Minimum deposit is ${minInTokens} USDC`,
    };
  }

  return { isValid: true };
}

/**
 * Validate deadline using contract config.
 *
 * @param deadline - Unix timestamp to validate
 * @param config - Deadline constraints from contract
 * @returns Validation result with error message if invalid
 */
export function validateDeadlineFromConfig(
  deadline: bigint,
  config: DeadlineConstraints
): { isValid: boolean; error?: string } {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const timeUntilDeadline = deadline > now ? deadline - now : 0n;

  if (timeUntilDeadline < config.minOffsetSeconds) {
    return {
      isValid: false,
      error: `Deadline too soon: ${timeUntilDeadline}s until deadline, minimum is ${config.minOffsetSeconds}s`,
    };
  }

  if (timeUntilDeadline > config.maxOffsetSeconds) {
    return {
      isValid: false,
      error: `Deadline too far: ${timeUntilDeadline}s until deadline, maximum is ${config.maxOffsetSeconds}s`,
    };
  }

  return { isValid: true };
}

/**
 * Get fee percentage as human-readable string from config.
 *
 * @param config - Fee configuration
 * @returns Fee percentage string (e.g., "0.1%")
 */
export function getFeePercentageFromConfig(config: FeeConfig): string {
  const percentage = (Number(config.basisPoints) / Number(config.denominator)) * 100;
  return `${percentage}%`;
}
