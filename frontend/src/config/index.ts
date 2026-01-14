/**
 * Frontend configuration
 *
 * Re-exports shared constants and provides frontend-specific defaults.
 */

// Re-export everything from shared package
export {
  // Chain IDs
  CHAIN_IDS,
  // RPC URLs
  LOCAL_RPC_URLS,
  AZTEC_CONFIG,
  // Token addresses
  USDC_ADDRESSES,
  USDC_DECIMALS,
  // Aave addresses
  AAVE_POOL_ADDRESSES,
  // Deadline defaults from shared
  DEFAULT_DEADLINE_OFFSET,
  MAX_DEADLINE_OFFSET,
  // Error codes
  ERROR_CODES,
} from "@aztec-aave-wrapper/shared";

// Re-export shared types
export type {
  Address,
  AztecAddress,
  Bytes32,
  TxHash,
  DepositIntent,
  WithdrawIntent,
  PositionReceipt,
  ContractAddresses,
  ChainConfig,
  EnvironmentConfig,
} from "@aztec-aave-wrapper/shared";

export { IntentStatus } from "@aztec-aave-wrapper/shared";

// Export frontend-specific constants
export {
  DEADLINE_CONSTRAINTS,
  DEPOSIT_STEP_LABELS,
  WITHDRAW_STEP_LABELS,
  TIMEOUTS,
  TOAST_DURATIONS,
  DEBOUNCE_DELAYS,
} from "./constants.js";

// Export chain configuration
export {
  L1_CHAINS,
  L2_CHAINS,
  isLocalDevelopment,
  getDefaultL1Chain,
  getDefaultL2Chain,
} from "./chains.js";

export type { AztecChainConfig } from "./chains.js";

// Export artifact loading utilities
export {
  loadArtifact,
  preloadArtifacts,
  clearArtifactCache,
} from "./artifacts.js";

export type { ContractArtifact, ContractName } from "./artifacts.js";
