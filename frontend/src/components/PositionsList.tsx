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
  /** Whether positions are currently being loaded */
  loading?: boolean;
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
      <Show when={props.loading}>
        <div class="flex items-center justify-center py-8">
          <div class="text-muted-foreground">Loading positions...</div>
        </div>
      </Show>

      <Show when={!props.loading}>
        <Show
          when={positions().length > 0}
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
            <For each={positions()}>
              {(position) => <PositionCard position={position} onWithdraw={props.onWithdraw} />}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
