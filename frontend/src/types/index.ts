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
  TxHash,
  // Intent types
  DepositIntent,
  WithdrawIntent,
  // Position types
  PositionReceipt,
  // Configuration types
  ContractAddresses,
  ChainConfig,
  EnvironmentConfig,
} from "@aztec-aave-wrapper/shared";

export { IntentStatus } from "@aztec-aave-wrapper/shared";

// =============================================================================
// Re-export State Types
// =============================================================================

export type {
  // State interfaces
  AppState,
  L1ConnectionState,
  L2ConnectionState,
  WalletState,
  L1Addresses,
  ContractsState,
  OperationState,
  // Display types
  PositionDisplay,
  LogEntry,
  LogLevel,
} from "./state.js";

export {
  // State factory
  createInitialAppState,
  // Bigint utilities
  toBigIntString,
  fromBigIntString,
  formatUSDC,
  formatUSDCFromString,
  parseUSDCInput,
} from "./state.js";

// =============================================================================
// Re-export Operation Types
// =============================================================================

export type {
  OperationType,
  OperationStatus,
  StepConfig,
  DepositStep,
  WithdrawStep,
} from "./operations.js";

export {
  DEPOSIT_STEPS,
  WITHDRAW_STEPS,
  getDepositStepCount,
  getWithdrawStepCount,
  getDepositStepIndex,
  getWithdrawStepIndex,
} from "./operations.js";
