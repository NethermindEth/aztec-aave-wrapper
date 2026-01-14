/**
 * Application store exports
 *
 * Main entry point for the SolidJS store.
 * Re-exports state, setState, actions, context, and hooks.
 */

// =============================================================================
// State and Setter
// =============================================================================

export { state, setState } from "./state.js";
export type { SetAppState } from "./state.js";

// =============================================================================
// Context and Provider
// =============================================================================

export { AppContext, AppProvider } from "./context.js";
export type { AppContextValue, AppActions, AppProviderProps } from "./context.js";

// =============================================================================
// Hooks
// =============================================================================

export { useApp, useAppState, useAppActions } from "./hooks.js";

// =============================================================================
// Actions
// =============================================================================

export {
  // L1 connection actions
  setL1Connection,
  setL1BlockNumber,
  // L2 connection actions
  setL2Connection,
  setL2BlockNumber,
  // Wallet actions
  setWallet,
  setL1Address,
  setL2Address,
  setUsdcBalance,
  setATokenBalance,
  // Contract actions
  setContracts,
  // Operation actions
  startOperation,
  setOperationStep,
  setOperationStatus,
  setOperationIntentId,
  setOperationError,
  addOperationLog,
  clearOperation,
  updateOperation,
  // Position actions
  setPositions,
  addPosition,
  updatePosition,
  removePosition,
  // Reset action
  resetState,
} from "./actions.js";

// =============================================================================
// Logger
// =============================================================================

export {
  // Constants
  MAX_LOG_ENTRIES,
  // Timestamp formatting
  formatLogTimestamp,
  formatLogTimestampWithMs,
  // Logging actions
  log,
  logInfo,
  logSuccess,
  logWarning,
  logError,
  logStep,
  logSection,
  clearLogs,
  // Log utilities
  getFormattedLogs,
  getLogCount,
} from "./logger.js";
export type { LogEntry, LogLevel } from "./logger.js";
