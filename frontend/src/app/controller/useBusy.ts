/**
 * Busy State Hook
 *
 * Manages busy flags for all operations with a uniform withBusy helper
 * that guarantees proper set/reset of flags even on errors.
 */

import { createMemo } from "solid-js";
import { createStore } from "solid-js/store";

/** Busy state for all operations */
export interface BusyState {
  bridging: boolean;
  depositing: boolean;
  executingDeposit: boolean;
  withdrawing: boolean;
  cancelling: boolean;
  finalizing: boolean;
  claimingRefund: boolean;
  claimingBridge: boolean;
  claimingWithdrawTokens: boolean;
}

export interface UseBusyResult {
  /** Reactive busy state object */
  busy: BusyState;
  /** Whether any operation is currently busy */
  isAnyBusy: () => boolean;
  /**
   * Execute an async function with automatic busy flag management.
   * Sets the flag before execution and clears it after (even on error).
   *
   * @param key - The busy flag to manage
   * @param fn - The async function to execute
   * @returns The result of fn, or undefined if already busy
   */
  withBusy: <T, K extends keyof BusyState>(key: K, fn: () => Promise<T>) => Promise<T | undefined>;
  /** Direct setter for busy state (for edge cases) */
  setBusy: <K extends keyof BusyState>(key: K, value: boolean) => void;
}

/**
 * Hook for managing operation busy states.
 *
 * Provides a withBusy helper that eliminates boilerplate try/finally
 * patterns for busy flag management.
 *
 * @example
 * const { busy, withBusy, isAnyBusy } = useBusy();
 *
 * const handleDeposit = async (amount: bigint) => {
 *   return withBusy("depositing", async () => {
 *     // ... deposit logic
 *     return result;
 *   });
 * };
 */
export function useBusy(): UseBusyResult {
  const [busy, setBusyStore] = createStore<BusyState>({
    bridging: false,
    depositing: false,
    executingDeposit: false,
    withdrawing: false,
    cancelling: false,
    finalizing: false,
    claimingRefund: false,
    claimingBridge: false,
    claimingWithdrawTokens: false,
  });

  const isAnyBusy = createMemo(() => Object.values(busy).some(Boolean));

  const setBusy = <K extends keyof BusyState>(key: K, value: boolean) => {
    setBusyStore(key, value);
  };

  const withBusy = async <T, K extends keyof BusyState>(
    key: K,
    fn: () => Promise<T>
  ): Promise<T | undefined> => {
    if (busy[key]) {
      return undefined;
    }
    setBusyStore(key, true);
    try {
      return await fn();
    } finally {
      setBusyStore(key, false);
    }
  };

  return { busy, isAnyBusy, withBusy, setBusy };
}
