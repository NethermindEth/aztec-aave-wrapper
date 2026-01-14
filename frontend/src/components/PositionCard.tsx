/**
 * PositionCard Component
 *
 * Displays an individual Aave position with intent ID, shares, status badge,
 * and withdraw button (for active positions only).
 */

import { IntentStatus } from "@aztec-aave-wrapper/shared";
import { Show } from "solid-js";
import { Badge, type BadgeVariant } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import type { Position } from "../hooks/usePositions.js";

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
function getStatusVariant(status: IntentStatus): BadgeVariant {
  switch (status) {
    case IntentStatus.PendingDeposit:
      return "secondary";
    case IntentStatus.Active:
      return "default";
    case IntentStatus.PendingWithdraw:
      return "outline";
    case IntentStatus.Consumed:
      return "destructive";
    default:
      return "destructive";
  }
}

/**
 * Get human-readable label for position status
 */
function getStatusLabel(status: IntentStatus): string {
  switch (status) {
    case IntentStatus.PendingDeposit:
      return "Pending Deposit";
    case IntentStatus.Active:
      return "Active";
    case IntentStatus.PendingWithdraw:
      return "Pending Withdraw";
    case IntentStatus.Consumed:
      return "Consumed";
    default:
      return "Unknown";
  }
}

/**
 * Format shares for display (USDC has 6 decimals)
 * Uses bigint arithmetic to avoid precision loss for large values
 */
function formatShares(shares: bigint): string {
  const DECIMALS = 6n;
  const SCALE = 10n ** DECIMALS;
  const wholePart = shares / SCALE;
  const decimalPart = shares % SCALE;
  // Pad decimal part with leading zeros
  const decimalStr = decimalPart.toString().padStart(Number(DECIMALS), "0");
  return `${wholePart}.${decimalStr}`;
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
 *     assetId: "0x01",
 *     shares: 1000000n,
 *     sharesFormatted: "1.000000",
 *     status: IntentStatus.Active,
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
        <Show when={props.position.status === IntentStatus.Active}>
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
