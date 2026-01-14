/**
 * Application state types
 *
 * Defines the AppState interface and related types for UI state management.
 * Bigint values are stored as strings to support SolidJS stores and JSON serialization.
 */

import type { Address, AztecAddress, IntentStatus } from "@aztec-aave-wrapper/shared";
import type { OperationStatus, OperationType } from "./operations.js";

// =============================================================================
// Bigint Serialization Utilities
// =============================================================================

/**
 * Convert bigint to string for store/JSON compatibility
 */
export const toBigIntString = (value: bigint): string => value.toString();

/**
 * Convert string back to bigint
 */
export const fromBigIntString = (value: string): bigint => BigInt(value);

/**
 * Format USDC amount for display (6 decimals)
 */
export const formatUSDC = (shares: bigint): string => {
  return (Number(shares) / 1_000_000).toFixed(6);
};

/**
 * Format USDC from string representation
 */
export const formatUSDCFromString = (shares: string): string => {
  return formatUSDC(BigInt(shares));
};

/**
 * Parse USDC input to bigint (handles decimal input)
 */
export const parseUSDCInput = (input: string): bigint => {
  const parts = input.split(".");
  const wholePart = parts[0] || "0";
  let decimalPart = parts[1] || "";

  // Pad or truncate to 6 decimals
  decimalPart = decimalPart.slice(0, 6).padEnd(6, "0");

  return BigInt(wholePart + decimalPart);
};

// =============================================================================
// Log Entry Types
// =============================================================================

/**
 * Log level for operation logs
 */
export type LogLevel = "info" | "success" | "warning" | "error";

/**
 * Single log entry for operation tracking
 */
export interface LogEntry {
  /** Timestamp of the log entry */
  timestamp: number;
  /** Log level */
  level: LogLevel;
  /** Log message */
  message: string;
  /** Optional transaction hash */
  txHash?: string;
}

// =============================================================================
// Position Display Types
// =============================================================================

/**
 * Position for UI display with bigint as string
 */
export interface PositionDisplay {
  /** Unique intent identifier (hex string) */
  intentId: string;
  /** Asset identifier (hex string) */
  assetId: string;
  /** Number of shares as string for store compatibility */
  shares: string;
  /** Human-readable formatted shares (e.g., "1.000000 USDC") */
  sharesFormatted: string;
  /** Current status of the position */
  status: IntentStatus;
}

// =============================================================================
// Connection State Types
// =============================================================================

/**
 * L1 (Ethereum) connection state
 */
export interface L1ConnectionState {
  /** Whether connected to L1 */
  connected: boolean;
  /** Connected chain ID */
  chainId: number;
  /** Current block number */
  blockNumber: number;
}

/**
 * L2 (Aztec) connection state
 */
export interface L2ConnectionState {
  /** Whether connected to L2 */
  connected: boolean;
  /** Node version string */
  nodeVersion: string;
  /** Current block number */
  blockNumber: number;
}

// =============================================================================
// Wallet State Types
// =============================================================================

/**
 * Wallet state with balances as strings for store compatibility
 */
export interface WalletState {
  /** Connected L1 wallet address */
  l1Address: Address | null;
  /** Connected L2 wallet address */
  l2Address: AztecAddress | null;
  /** USDC balance as string */
  usdcBalance: string;
  /** aToken balance as string */
  aTokenBalance: string;
}

// =============================================================================
// Contract State Types
// =============================================================================

/**
 * L1 contract addresses
 */
export interface L1Addresses {
  /** Portal contract address */
  portal: Address | null;
  /** Mock USDC token address */
  mockUsdc: Address | null;
  /** Mock Aave lending pool address */
  mockLendingPool: Address | null;
}

/**
 * All deployed contract addresses
 */
export interface ContractsState extends L1Addresses {
  /** L2 wrapper contract address */
  l2Wrapper: AztecAddress | null;
}

// =============================================================================
// Operation State Types
// =============================================================================

/**
 * Current operation state
 */
export interface OperationState {
  /** Type of operation being performed */
  type: OperationType;
  /** Current step number (1-indexed) */
  step: number;
  /** Total number of steps */
  totalSteps: number;
  /** Current operation status */
  status: OperationStatus;
  /** Intent ID if operation has started */
  intentId: string | null;
  /** Error message if status is "error" */
  error: string | null;
  /** Operation log entries */
  logs: LogEntry[];
}

// =============================================================================
// App State Interface
// =============================================================================

/**
 * Complete application state
 * Matches frontend-requirements.md specification
 */
export interface AppState {
  /** L1 connection status */
  l1: L1ConnectionState;

  /** L2 connection status */
  l2: L2ConnectionState;

  /** Wallet state */
  wallet: WalletState;

  /** Contract addresses (deployed) */
  contracts: ContractsState;

  /** Current operation */
  operation: OperationState;

  /** User positions */
  positions: PositionDisplay[];
}

// =============================================================================
// Initial State Factory
// =============================================================================

/**
 * Create initial app state with default values
 */
export function createInitialAppState(): AppState {
  return {
    l1: {
      connected: false,
      chainId: 0,
      blockNumber: 0,
    },
    l2: {
      connected: false,
      nodeVersion: "",
      blockNumber: 0,
    },
    wallet: {
      l1Address: null,
      l2Address: null,
      usdcBalance: "0",
      aTokenBalance: "0",
    },
    contracts: {
      portal: null,
      mockUsdc: null,
      mockLendingPool: null,
      l2Wrapper: null,
    },
    operation: {
      type: "idle",
      step: 0,
      totalSteps: 0,
      status: "pending",
      intentId: null,
      error: null,
      logs: [],
    },
    positions: [],
  };
}
