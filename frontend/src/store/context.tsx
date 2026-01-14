/**
 * Application context provider
 *
 * Provides the SolidJS store and actions to the component tree via context.
 * Components can access state and actions through the useApp hook.
 */

import { createContext, type JSX } from "solid-js";
import type { AppState } from "../types/state.js";
import { state, setState, type SetAppState } from "./state.js";
import * as actions from "./actions.js";

// =============================================================================
// Context Types
// =============================================================================

/**
 * All action functions exported from actions module
 */
export type AppActions = typeof actions;

/**
 * Context value containing state and actions
 */
export interface AppContextValue {
  /** Reactive application state (read-only proxy) */
  state: AppState;
  /** Store setter for direct state mutations */
  setState: SetAppState;
  /** Action functions for state updates */
  actions: AppActions;
}

// =============================================================================
// Context Creation
// =============================================================================

/**
 * Application context
 *
 * Provides access to:
 * - state: Reactive application state
 * - setState: Direct store setter
 * - actions: Action functions for state mutations
 */
export const AppContext = createContext<AppContextValue | undefined>(undefined);

// =============================================================================
// Provider Component
// =============================================================================

/**
 * Props for AppProvider component
 */
export interface AppProviderProps {
  /** Child components that will have access to the context */
  children: JSX.Element;
}

/**
 * Context value instance (created once)
 */
const contextValue: AppContextValue = {
  state,
  setState,
  actions,
};

/**
 * Application context provider component
 *
 * Wraps the component tree to provide store access via context.
 * Must be placed at the root of the application.
 *
 * @example
 * ```tsx
 * import { AppProvider } from "./store/context";
 *
 * function App() {
 *   return (
 *     <AppProvider>
 *       <MainContent />
 *     </AppProvider>
 *   );
 * }
 * ```
 */
export function AppProvider(props: AppProviderProps): JSX.Element {
  return (
    <AppContext.Provider value={contextValue}>
      {props.children}
    </AppContext.Provider>
  );
}
