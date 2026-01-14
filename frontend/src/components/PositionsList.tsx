/**
 * PositionsList Component
 *
 * Displays a list of all user Aave positions with empty state handling.
 * Uses the For component to efficiently render position cards.
 */

import { For, Show } from "solid-js";
import { PositionCard, type Position } from "./PositionCard";

/**
 * Props for PositionsList component
 */
export interface PositionsListProps {
  /** Array of positions to display */
  positions: Position[];
  /** Callback when withdraw is requested for a position */
  onWithdraw: (intentId: string) => void;
  /** Whether positions are currently being loaded */
  loading?: boolean;
  /** Optional: CSS class for the container */
  class?: string;
}

/**
 * PositionsList renders a list of user positions with empty state handling.
 *
 * Features:
 * - Displays all positions using PositionCard components
 * - Shows empty state when no positions exist
 * - Shows loading state while fetching positions
 * - Passes withdraw callback to each position card
 *
 * @example
 * ```tsx
 * <PositionsList
 *   positions={[
 *     { intentId: "0x123...", shares: 1000000n, status: PositionStatus.CONFIRMED },
 *     { intentId: "0x456...", shares: 500000n, status: PositionStatus.PENDING_DEPOSIT },
 *   ]}
 *   onWithdraw={(intentId) => handleWithdraw(intentId)}
 * />
 * ```
 */
export function PositionsList(props: PositionsListProps) {
  return (
    <div class={props.class}>
      <Show when={props.loading}>
        <div class="flex items-center justify-center py-8">
          <div class="text-muted-foreground">Loading positions...</div>
        </div>
      </Show>

      <Show when={!props.loading}>
        <Show
          when={props.positions.length > 0}
          fallback={
            <div class="flex flex-col items-center justify-center py-8 text-center">
              <div class="text-muted-foreground mb-2">No positions yet</div>
              <div class="text-sm text-muted-foreground">
                Deposit USDC to create your first position
              </div>
            </div>
          }
        >
          <div class="grid gap-4">
            <For each={props.positions}>
              {(position) => (
                <PositionCard
                  position={position}
                  onWithdraw={props.onWithdraw}
                />
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
