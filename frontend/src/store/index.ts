/**
 * Application store exports
 *
 * Main entry point for the SolidJS store.
 * Re-exports state, setState, and all action functions.
 */

// =============================================================================
// State and Setter
// =============================================================================

export { state, setState } from "./state.js";
export type { SetAppState } from "./state.js";

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
