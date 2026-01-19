/**
 * Frontend type definitions
 *
 * Re-exports shared types and provides frontend-specific UI types
 * for state management and operation tracking.
 */

// =============================================================================
// Re-export Shared Types
// =============================================================================

export type {
  // Primitive types
  Address,
  AztecAddress,
  Bytes32,
  ChainConfig,
  // Configuration types
  ContractAddresses,
  // Intent types
  DepositIntent,
  EnvironmentConfig,
  // Position types
  PositionReceipt,
  TxHash,
  WithdrawIntent,
} from "@aztec-aave-wrapper/shared";

export { IntentStatus } from "@aztec-aave-wrapper/shared";

// =============================================================================
// Re-export State Types
// =============================================================================

export type {
  // State interfaces
  AppState,
  ContractsState,
  L1Addresses,
  L1ConnectionState,
  L2ConnectionState,
  LogEntry,
  LogLevel,
  OperationState,
  // Display types
  PositionDisplay,
  WalletState,
} from "./state.js";

export {
  // State factory
  createInitialAppState,
  formatUSDC,
  formatUSDCFromString,
  fromBigIntString,
  parseUSDCInput,
  // Bigint utilities
  toBigIntString,
} from "./state.js";

// =============================================================================
// Re-export Operation Types
// =============================================================================

export type {
  DepositStep,
  OperationStatus,
  OperationType,
  StepConfig,
  WithdrawStep,
} from "./operations.js";

export {
  DEPOSIT_STEPS,
  getDepositStepCount,
  getDepositStepIndex,
  getWithdrawStepCount,
  getWithdrawStepIndex,
  WITHDRAW_STEPS,
} from "./operations.js";

// =============================================================================
// Re-export Error Types
// =============================================================================

export {
  isNetworkError,
  isTimeoutError,
  isUserRejection,
  NetworkError,
  TimeoutError,
  UserRejectedError,
} from "./errors.js";

// =============================================================================
// Re-export Fee Configuration
// =============================================================================

/**
 * Protocol fee configuration for deposit/withdraw operations.
 * Used for calculating and displaying fees in the UI.
 */
export { FEE_CONFIG } from "../config/constants.js";
