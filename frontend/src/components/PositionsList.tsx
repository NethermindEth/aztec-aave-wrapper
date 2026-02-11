/**
 * PositionsList Component
 *
 * Displays a list of all user Aave positions with empty state handling.
 * Uses the usePositions hook for reactive position data with persistence.
 */

import { IntentStatus } from "@aztec-aave-wrapper/shared";
import { createMemo, For, Show } from "solid-js";
import type { BusyState } from "~/app/controller/useBusy";
import { usePositions } from "../hooks/usePositions.js";
import { PositionCard } from "./PositionCard.js";

/**
 * Props for PositionsList component
 */
export interface PositionsListProps {
  /** Callback when withdraw is requested for a position */
  onWithdraw: (intentId: string) => void;
  /** Callback when cancel is requested for a pending deposit */
  onCancel?: (intentId: string, deadline: bigint, netAmount: bigint) => void;
  /** Callback when finalize is requested for a pending deposit */
  onFinalizeDeposit?: (intentId: string) => void;
  /** Callback to refresh positions from L2 */
  onRefresh?: () => void;
  /** Whether positions are currently being refreshed from L2 */
  isRefreshing?: boolean;
  /** Whether positions are currently being loaded */
  loading?: boolean;
  /** Current L1 timestamp for deadline comparison (use L1 time, not local) */
  currentL1Timestamp?: bigint;
  /** Busy state for disabling buttons during in-flight operations */
  busy?: BusyState;
  /** Optional: CSS class for the container */
  class?: string;
}

/**
 * PositionsList renders a list of user positions with empty state handling.
 *
 * Features:
 * - Uses usePositions hook for reactive position data with persistence
 * - Displays all positions using PositionCard components
 * - Shows empty state when no positions exist
 * - Shows loading state while fetching positions
 * - Passes withdraw callback to each position card
 * - Automatically re-renders when positions change in the store
 *
 * @example
 * ```tsx
 * <PositionsList
 *   onWithdraw={(intentId) => handleWithdraw(intentId)}
 * />
 * ```
 */
export function PositionsList(props: PositionsListProps) {
  const { positions } = usePositions();

  // Filter out PendingWithdraw positions — they're shown in the dedicated PendingWithdrawals section
  const activePositions = createMemo(() =>
    positions().filter((p) => p.status !== IntentStatus.PendingWithdraw)
  );

  return (
    <Show when={props.loading || activePositions().length > 0}>
      <div class={props.class}>
        {/* Header */}
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-zinc-100">Your Positions</h2>
        </div>

        <Show when={props.loading}>
          <div class="flex items-center justify-center py-8">
            <div class="text-muted-foreground">Loading positions...</div>
          </div>
        </Show>

        <Show when={!props.loading}>
          <div class="grid gap-4">
            <For each={activePositions()}>
              {(position) => (
                <PositionCard
                  position={position}
                  onWithdraw={props.onWithdraw}
                  onCancel={props.onCancel}
                  onFinalizeDeposit={props.onFinalizeDeposit}
                  currentL1Timestamp={props.currentL1Timestamp}
                  busy={props.busy}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
