/**
 * Shared TypeScript types for Aztec Aave Wrapper
 * These types mirror the Solidity/Noir structs used across the system
 */

// =============================================================================
// Primitive Types
// =============================================================================

/** Ethereum address (hex string with 0x prefix) */
export type Address = `0x${string}`;

/** Aztec L2 address (32-byte hex string) */
export type AztecAddress = `0x${string}`;

/** 32-byte hash/identifier (hex string) */
export type Bytes32 = `0x${string}`;

/** Transaction hash */
export type TxHash = `0x${string}`;

// =============================================================================
// Intent Types
// =============================================================================

/**
 * Status of an intent in the system
 * Maps to u8 values used in Noir contract
 */
export enum IntentStatus {
  /** Deposit requested, awaiting execution */
  PendingDeposit = 0,
  /** Position is active (deposit confirmed) */
  Active = 1,
  /** Withdrawal requested, awaiting execution */
  PendingWithdraw = 2,
  /** Intent has been consumed/finalized */
  Consumed = 3,
}

/**
 * Deposit intent created on L2
 * Sent via L2→L1 message to portal
 */
export interface DepositIntent {
  /** Unique identifier for this intent */
  intentId: Bytes32;
  /** Asset identifier (maps to L1 token address) */
  assetId: Bytes32;
  /** Amount to deposit (in token decimals) */
  amount: bigint;
  /** Unix timestamp deadline for execution */
  deadline: bigint;
  /** L2 owner address (for confirmation routing) */
  ownerL2: AztecAddress;
}

/**
 * Withdraw intent created on L2
 * Sent via L2→L1 message to portal
 */
export interface WithdrawIntent {
  /** Unique identifier for this intent */
  intentId: Bytes32;
  /** Amount to withdraw (in token decimals) */
  amount: bigint;
  /** Unix timestamp deadline for execution */
  deadline: bigint;
}

// =============================================================================
// Position Types
// =============================================================================

/**
 * Position receipt representing user's claim on Aave position
 * This mirrors the PositionReceiptNote in Noir
 */
export interface PositionReceipt {
  /** L2 owner of this position */
  owner: AztecAddress;
  /** Unique nonce for this receipt */
  nonce: bigint;
  /** Asset identifier */
  assetId: Bytes32;
  /** Number of shares (proportional claim on aTokens) */
  shares: bigint;
  /** Current status of the position */
  status: IntentStatus;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Contract addresses for a specific environment
 */
export interface ContractAddresses {
  l2: {
    /** Aztec Aave Wrapper contract address */
    aaveWrapper: AztecAddress;
  };
  l1: {
    /** Portal contract address on Ethereum */
    portal: Address;
    /** Mock USDC token address (for local development) */
    mockUsdc: Address;
    /** Mock Aave lending pool address (for local development) */
    mockLendingPool: Address;
  };
}

/**
 * Chain configuration for RPC and chain IDs
 */
export interface ChainConfig {
  /** Human-readable chain name */
  name: string;
  /** Native chain ID (EVM chain ID or Aztec network ID) */
  chainId: number;
  /** RPC endpoint URL */
  rpcUrl: string;
}

/**
 * Environment configuration
 */
export interface EnvironmentConfig {
  /** Contract addresses */
  addresses: ContractAddresses;
  /** L1 chain config (Ethereum/Sepolia) */
  l1: ChainConfig;
  /** L2 chain config (Aztec) */
  l2: ChainConfig;
}
