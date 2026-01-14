/**
 * Frontend configuration
 *
 * Re-exports shared constants and provides frontend-specific defaults.
 */

// Re-export shared types
export type {
  Address,
  AztecAddress,
  Bytes32,
  ChainConfig,
  ContractAddresses,
  DepositIntent,
  EnvironmentConfig,
  PositionReceipt,
  TxHash,
  WithdrawIntent,
} from "@aztec-aave-wrapper/shared";
// Re-export everything from shared package
export {
  // Aave addresses
  AAVE_POOL_ADDRESSES,
  AZTEC_CONFIG,
  // Chain IDs
  CHAIN_IDS,
  // Deadline defaults from shared
  DEFAULT_DEADLINE_OFFSET,
  // Error codes
  ERROR_CODES,
  IntentStatus,
  // RPC URLs
  LOCAL_RPC_URLS,
  MAX_DEADLINE_OFFSET,
  // Token addresses
  USDC_ADDRESSES,
  USDC_DECIMALS,
} from "@aztec-aave-wrapper/shared";
export type { ContractArtifact, ContractName } from "./artifacts.js";
// Export artifact loading utilities
export {
  clearArtifactCache,
  loadArtifact,
  preloadArtifacts,
} from "./artifacts.js";

export type { AztecChainConfig } from "./chains.js";
// Export chain configuration
export {
  getDefaultL1Chain,
  getDefaultL2Chain,
  isLocalDevelopment,
  L1_CHAINS,
  L2_CHAINS,
} from "./chains.js";
// Export frontend-specific constants
export {
  DEADLINE_CONSTRAINTS,
  DEBOUNCE_DELAYS,
  DEPOSIT_STEP_LABELS,
  TIMEOUTS,
  TOAST_DURATIONS,
  WITHDRAW_STEP_LABELS,
} from "./constants.js";
