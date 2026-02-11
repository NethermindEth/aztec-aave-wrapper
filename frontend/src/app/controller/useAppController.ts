/**
 * Application Controller Hook (Thin Composer)
 *
 * Composes all domain hooks into a unified API for the UI.
 * This hook should remain small (~100 lines) - all logic lives in domain hooks.
 *
 * Domain hooks:
 * - useLogger: Operation logging
 * - useBusy: Busy state management
 * - useBalances: L1 balance refresh
 * - useL2Positions: Position refresh from L2
 * - useBridge: Bridge state and claiming
 * - useOperations: Protocol operations (bridge, deposit, withdraw, cancel, refund)
 */

import { IntentStatus } from "@aztec-aave-wrapper/shared";
import { createMemo } from "solid-js";
import type { PendingBridge } from "../../services/pendingBridges";
import { useApp } from "../../store/hooks";
import { useBalances } from "./useBalances";
import { type BridgeState, useBridge } from "./useBridge";
import { type BusyState, useBusy } from "./useBusy";
import { useL2Positions } from "./useL2Positions";
import { useLogger } from "./useLogger";
import { useOperations } from "./useOperations";
import { type PendingDepositState, usePendingDeposits } from "./usePendingDeposits";

export { formatAmount } from "../../shared/format/usdc";
export type { BridgeState } from "./useBridge";
// Re-export types and utilities for consumers
export type { BusyState } from "./useBusy";
export type { PendingDepositState } from "./usePendingDeposits";

/** Controller return type */
export interface AppController {
  // State
  logs: () => import("../../components/LogViewer").LogEntry[];
  busy: BusyState;
  bridge: BridgeState;
  pendingDeposits: PendingDepositState;

  // Derived values
  derived: {
    totalValueLocked: () => bigint;
    activePositionCount: () => number;
    readyClaimsCount: () => number;
    isAnyOperationBusy: () => boolean;
  };

  // Positions
  positions: ReturnType<typeof useL2Positions>["positionHooks"];

  // Actions
  actions: {
    addLog: (message: string, level?: import("../../components/LogViewer").LogLevel) => void;
    handleBridge: (amount: bigint) => Promise<void>;
    handleDeposit: (amount: bigint, deadline: number) => Promise<void>;
    handleWithdraw: (intentId: string) => Promise<void>;
    handleCancelDeposit: (intentId: string, deadline: bigint, netAmount: bigint) => Promise<void>;
    handleFinalizeDeposit: (intentId: string) => Promise<void>;
    handleClaimRefund: (
      intentId: string,
      deadline: bigint,
      shares: bigint,
      assetId: string
    ) => Promise<void>;
    handleDepositPhase1: (amount: bigint, deadline: number) => Promise<void>;
    handleDepositPhase2: (intentId: string) => Promise<void>;
    handleClaimBridge: (bridge: PendingBridge) => Promise<void>;
    handleRefreshBridges: () => Promise<void>;
    handleRefreshPositions: () => Promise<void>;
    handleRefreshPendingDeposits: () => Promise<void>;
  };
}

/**
 * Main application controller hook.
 *
 * Composes domain hooks and exposes a unified API.
 * All business logic is delegated to specialized hooks.
 *
 * @returns Controller with state, derived values, and actions
 */
export function useAppController(): AppController {
  const { state } = useApp();

  // Cross-cutting hooks
  const { logs, addLog } = useLogger();
  const { busy, isAnyBusy, withBusy } = useBusy();
  const { refreshBalances } = useBalances();

  // Domain hooks
  const { positionHooks, handleRefreshPositions } = useL2Positions();
  const { bridgeState, readyClaimsCount, handleRefreshBridges, handleClaimBridge } = useBridge();
  const { pendingDepositState, handleExecuteDeposit, handleRefreshPendingDeposits } =
    usePendingDeposits();

  // Operations (with injected dependencies)
  const operations = useOperations({
    addLog,
    withBusy,
    refreshBalances,
    positionHooks,
  });

  // Derived values
  const totalValueLocked = createMemo(() => {
    return state.positions.reduce((sum, pos) => {
      if (pos.status === IntentStatus.Confirmed) {
        return sum + BigInt(pos.shares);
      }
      return sum;
    }, 0n);
  });

  const activePositionCount = createMemo(() => {
    return state.positions.filter((pos) => pos.status === IntentStatus.Confirmed).length;
  });

  // Return unified API
  return {
    logs,
    busy,
    bridge: bridgeState,
    pendingDeposits: pendingDepositState,
    derived: {
      totalValueLocked,
      activePositionCount,
      readyClaimsCount,
      isAnyOperationBusy: isAnyBusy,
    },
    positions: positionHooks,
    actions: {
      addLog,
      handleBridge: operations.handleBridge,
      handleDeposit: operations.handleDeposit,
      handleWithdraw: operations.handleWithdraw,
      handleCancelDeposit: operations.handleCancelDeposit,
      handleFinalizeDeposit: operations.handleFinalizeDeposit,
      handleClaimRefund: operations.handleClaimRefund,
      handleDepositPhase1: operations.handleDepositPhase1,
      handleDepositPhase2: (intentId) => handleExecuteDeposit(intentId, addLog),
      handleClaimBridge: (bridge) => handleClaimBridge(bridge, addLog),
      handleRefreshBridges: () => handleRefreshBridges(addLog),
      handleRefreshPositions: () => handleRefreshPositions(addLog),
      handleRefreshPendingDeposits: () => handleRefreshPendingDeposits(addLog),
    },
  };
}
