/**
 * Application store exports
 *
 * Main entry point for the SolidJS store.
 * Re-exports state, setState, actions, context, and hooks.
 */

// =============================================================================
// State and Setter
// =============================================================================

export type { SetAppState } from "./state.js";
export { setState, state } from "./state.js";

// =============================================================================
// Context and Provider
// =============================================================================

export type { AppActions, AppContextValue, AppProviderProps } from "./context.js";
export { AppContext, AppProvider } from "./context.js";

// =============================================================================
// Hooks
// =============================================================================

export { useApp, useAppActions, useAppState } from "./hooks.js";

// =============================================================================
// Actions
// =============================================================================

export {
  addOperationLog,
  addPosition,
  clearOperation,
  removePosition,
  // Reset action
  resetState,
  setATokenBalance,
  // Contract actions
  setContracts,
  setL1Address,
  setL1BlockNumber,
  // L1 connection actions
  setL1Connection,
  setL2Address,
  setL2BlockNumber,
  // L2 connection actions
  setL2Connection,
  setOperationError,
  setOperationIntentId,
  setOperationStatus,
  setOperationStep,
  // Position actions
  setPositions,
  setUsdcBalance,
  // Wallet actions
  setWallet,
  // Operation actions
  startOperation,
  updateOperation,
  updatePosition,
} from "./actions.js";

// =============================================================================
// Logger
// =============================================================================

export type { LogEntry, LogLevel } from "./logger.js";
export {
  clearLogs,
  // Timestamp formatting
  formatLogTimestamp,
  formatLogTimestampWithMs,
  // Log utilities
  getFormattedLogs,
  getLogCount,
  // Logging actions
  log,
  logError,
  logInfo,
  logSection,
  logStep,
  logSuccess,
  logWarning,
  // Constants
  MAX_LOG_ENTRIES,
} from "./logger.js";
