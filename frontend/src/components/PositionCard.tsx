/**
 * PositionCard Component
 *
 * Displays an individual Aave position with intent ID, shares, status badge,
 * and withdraw button (for active positions only).
 */

import { Show } from "solid-js";
import { Badge, type BadgeVariant } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

/**
 * Position status values matching the L2 contract
 */
export enum PositionStatus {
  UNKNOWN = 0,
  PENDING_DEPOSIT = 1,
  CONFIRMED = 2, // Active
  PENDING_WITHDRAW = 4,
}

/**
 * Position data structure
 */
export interface Position {
  /** Unique identifier for the intent */
  intentId: string;
  /** Number of aUSDC shares held */
  shares: bigint;
  /** Current status of the position */
  status: PositionStatus;
}

/**
 * Props for PositionCard component
 */
export interface PositionCardProps {
  /** The position to display */
  position: Position;
  /** Callback when withdraw button is clicked */
  onWithdraw: (intentId: string) => void;
  /** Optional: CSS class for the container */
  class?: string;
}

/**
 * Get the badge variant based on position status
 */
function getStatusVariant(status: PositionStatus): BadgeVariant {
  switch (status) {
    case PositionStatus.PENDING_DEPOSIT:
      return "secondary";
    case PositionStatus.CONFIRMED:
      return "default";
    case PositionStatus.PENDING_WITHDRAW:
      return "outline";
    default:
      return "destructive";
  }
}

/**
 * Get human-readable label for position status
 */
function getStatusLabel(status: PositionStatus): string {
  switch (status) {
    case PositionStatus.PENDING_DEPOSIT:
      return "Pending Deposit";
    case PositionStatus.CONFIRMED:
      return "Active";
    case PositionStatus.PENDING_WITHDRAW:
      return "Pending Withdraw";
    default:
      return "Unknown";
  }
}

/**
 * Format shares for display (USDC has 6 decimals)
 */
function formatShares(shares: bigint): string {
  return (Number(shares) / 1_000_000).toFixed(6);
}

/**
 * PositionCard renders a card displaying an Aave position.
 *
 * Features:
 * - Displays truncated intent ID in header
 * - Status badge with variant based on position status
 * - Formatted share amount in aUSDC
 * - Withdraw button only shown for active (CONFIRMED) positions
 *
 * @example
 * ```tsx
 * <PositionCard
 *   position={{
 *     intentId: "0x1234567890abcdef",
 *     shares: 1000000n,
 *     status: PositionStatus.CONFIRMED,
 *   }}
 *   onWithdraw={(intentId) => console.log("Withdraw:", intentId)}
 * />
 * ```
 */
export function PositionCard(props: PositionCardProps) {
  const statusVariant = () => getStatusVariant(props.position.status);
  const statusLabel = () => getStatusLabel(props.position.status);

  return (
    <Card class={props.class}>
      <CardHeader class="flex flex-row items-center justify-between pb-2">
        <CardTitle class="text-sm font-medium">
          Position #{props.position.intentId.slice(0, 8)}...
        </CardTitle>
        <Badge variant={statusVariant()}>{statusLabel()}</Badge>
      </CardHeader>
      <CardContent>
        <div class="text-2xl font-bold">{formatShares(props.position.shares)} aUSDC</div>
        <Show when={props.position.status === PositionStatus.CONFIRMED}>
          <Button
            variant="outline"
            size="sm"
            class="mt-2"
            onClick={() => props.onWithdraw(props.position.intentId)}
          >
            Withdraw
          </Button>
        </Show>
      </CardContent>
    </Card>
  );
}
