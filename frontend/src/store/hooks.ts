/**
 * Store hooks
 *
 * Custom hooks for accessing the application store context.
 * Provides type-safe access to state and actions within the provider boundary.
 */

import { useContext } from "solid-js";
import { AppContext, type AppContextValue } from "./context.js";

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook to access the application store context
 *
 * Must be called within an AppProvider component tree.
 * Throws an error if called outside the provider boundary.
 *
 * @returns The context value containing state, setState, and actions
 * @throws Error if used outside of AppProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { state, actions } = useApp();
 *
 *   return (
 *     <div>
 *       <p>Connected: {state.l1.connected ? "Yes" : "No"}</p>
 *       <button onClick={() => actions.setL1Connection({ connected: true })}>
 *         Connect
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useApp(): AppContextValue {
  const context = useContext(AppContext);

  if (context === undefined) {
    throw new Error("useApp must be used within an AppProvider");
  }

  return context;
}

/**
 * Hook to access only the application state
 *
 * Convenience hook when only read access is needed.
 * Must be called within an AppProvider component tree.
 *
 * @returns The reactive application state
 * @throws Error if used outside of AppProvider
 *
 * @example
 * ```tsx
 * function StatusDisplay() {
 *   const state = useAppState();
 *   return <p>Balance: {state.wallet.usdcBalance}</p>;
 * }
 * ```
 */
export function useAppState(): AppContextValue["state"] {
  return useApp().state;
}

/**
 * Hook to access only the action functions
 *
 * Convenience hook when only actions are needed.
 * Must be called within an AppProvider component tree.
 *
 * @returns The action functions object
 * @throws Error if used outside of AppProvider
 *
 * @example
 * ```tsx
 * function ConnectButton() {
 *   const actions = useAppActions();
 *   return (
 *     <button onClick={() => actions.setL1Connection({ connected: true })}>
 *       Connect
 *     </button>
 *   );
 * }
 * ```
 */
export function useAppActions(): AppContextValue["actions"] {
  return useApp().actions;
}
