/**
 * Application store state
 *
 * Creates and exports the SolidJS store for managing application state.
 * Uses createStore for fine-grained reactivity with nested object updates.
 */

import { createStore } from "solid-js/store";
import type { AppState } from "../types/state.js";
import { createInitialAppState } from "../types/state.js";

// =============================================================================
// Store Creation
// =============================================================================

/**
 * Application store tuple [state, setState]
 *
 * The store manages:
 * - L1/L2 connection state
 * - Wallet info and balances
 * - Contract addresses
 * - Current operation progress
 * - User positions
 */
const [state, setState] = createStore<AppState>(createInitialAppState());

// =============================================================================
// Exports
// =============================================================================

/**
 * Reactive application state (read-only proxy)
 * Access properties directly: state.l1.connected, state.wallet.usdcBalance, etc.
 */
export { state };

/**
 * Store setter function for state mutations
 * Use path syntax for nested updates: setState("l1", "connected", true)
 */
export { setState };

/**
 * Type for the setState function
 */
export type SetAppState = typeof setState;
