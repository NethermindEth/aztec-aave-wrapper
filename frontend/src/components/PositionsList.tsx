/**
 * PositionsList Component
 *
 * Displays a list of all user Aave positions with empty state handling.
 * Uses the usePositions hook for reactive position data with persistence.
 */

import { For, Show } from "solid-js";
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
  /** Callback when refund is requested for an expired pending withdrawal */
  onClaimRefund?: (intentId: string, deadline: bigint, shares: bigint, assetId: string) => void;
  /** Callback to refresh positions from L2 */
  onRefresh?: () => void;
  /** Whether positions are currently being refreshed from L2 */
  isRefreshing?: boolean;
  /** Whether positions are currently being loaded */
  loading?: boolean;
  /** Current L1 timestamp for deadline comparison (use L1 time, not local) */
  currentL1Timestamp?: bigint;
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

  return (
    <div class={props.class}>
      {/* Header with title and refresh button */}
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold text-zinc-100">Your Positions</h2>
        <Show when={props.onRefresh}>
          <button
            type="button"
            onClick={props.onRefresh}
            disabled={props.isRefreshing}
            class="px-3 py-1.5 text-sm font-medium rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            <Show when={props.isRefreshing} fallback={<span>Refresh from L2</span>}>
              <svg
                class="animate-spin h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                />
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span>Refreshing...</span>
            </Show>
          </button>
        </Show>
      </div>

      <Show when={props.loading}>
        <div class="flex items-center justify-center py-8">
          <div class="text-muted-foreground">Loading positions...</div>
        </div>
      </Show>

      <Show when={!props.loading}>
        <Show
          when={positions().length > 0}
          fallback={
            <div class="empty-state">
              {/* Empty state icon - vault/safe representing positions */}
              <div class="empty-state-icon">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 3v3" />
                  <path d="M12 18v3" />
                  <path d="M3 12h3" />
                  <path d="M18 12h3" />
                </svg>
              </div>
              <div class="empty-state-title">No positions yet</div>
              <div class="empty-state-description">
                Deposit USDC to create your first privacy-preserving Aave position
              </div>
              <Show when={props.onRefresh}>
                <div class="empty-state-hint">
                  Or click "Refresh from L2" to sync existing positions
                </div>
              </Show>
            </div>
          }
        >
          <div class="grid gap-4">
            <For each={positions()}>
              {(position) => (
                <PositionCard
                  position={position}
                  onWithdraw={props.onWithdraw}
                  onCancel={props.onCancel}
                  onClaimRefund={props.onClaimRefund}
                  currentL1Timestamp={props.currentL1Timestamp}
                />
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
