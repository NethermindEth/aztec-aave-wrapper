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
  /** Callback when cancel button is clicked for expired pending deposits */
  onCancel?: (intentId: string, deadline: bigint, netAmount: bigint) => void;
  /** Callback when refund button is clicked for expired pending withdrawals */
  onClaimRefund?: (intentId: string, deadline: bigint, shares: bigint, assetId: string) => void;
  /** Current L1 timestamp for deadline comparison (use L1 time, not local) */
  currentL1Timestamp?: bigint;
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
    case IntentStatus.Confirmed:
      return "default";
    case IntentStatus.PendingWithdraw:
      return "outline";
    case IntentStatus.Withdrawn:
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
    case IntentStatus.Confirmed:
      return "Active";
    case IntentStatus.PendingWithdraw:
      return "Pending Withdraw";
    case IntentStatus.Withdrawn:
      return "Withdrawn";
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

  // Check if this is a pending deposit that can be cancelled
  // Cancellation is allowed when:
  // 1. Status is PendingDeposit
  // 2. Deadline has passed (currentL1Timestamp > deadline)
  // 3. We have the required data (deadline, netAmount, onCancel callback)
  const canCancel = () => {
    if (props.position.status !== IntentStatus.PendingDeposit) return false;
    if (!props.onCancel) return false;
    if (!props.currentL1Timestamp) return false;
    if (props.position.deadline === 0n) return false;
    // L1 uses strict greater than: current_time > deadline
    return props.currentL1Timestamp > props.position.deadline;
  };

  const handleCancel = () => {
    if (props.onCancel && canCancel()) {
      props.onCancel(props.position.intentId, props.position.deadline, props.position.netAmount);
    }
  };

  // Check if this is a pending withdrawal that can be refunded
  // Refund is allowed when:
  // 1. Status is PendingWithdraw
  // 2. Deadline has passed (currentL1Timestamp >= deadline)
  // 3. We have the required data (deadline, shares, onClaimRefund callback)
  const canClaimRefund = () => {
    if (props.position.status !== IntentStatus.PendingWithdraw) return false;
    if (!props.onClaimRefund) return false;
    if (!props.currentL1Timestamp) return false;
    if (props.position.deadline === 0n) return false;
    // Contract uses: current_time >= deadline
    return props.currentL1Timestamp >= props.position.deadline;
  };

  const handleClaimRefund = () => {
    if (props.onClaimRefund && canClaimRefund()) {
      props.onClaimRefund(
        props.position.intentId,
        props.position.deadline,
        props.position.shares,
        props.position.assetId
      );
    }
  };

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
        <Show when={props.position.status === IntentStatus.Confirmed}>
          <Button
            variant="outline"
            size="sm"
            class="mt-2"
            onClick={() => props.onWithdraw(props.position.intentId)}
          >
            Withdraw
          </Button>
        </Show>
        <Show when={props.position.status === IntentStatus.PendingWithdraw && !canClaimRefund()}>
          <p class="mt-2 text-xs text-muted-foreground">
            Tokens deposited to L2. Check "Pending Bridge Claims" to claim.
          </p>
        </Show>
        <Show when={canCancel()}>
          <Button variant="destructive" size="sm" class="mt-2" onClick={handleCancel}>
            Cancel Deposit
          </Button>
        </Show>
        <Show when={canClaimRefund()}>
          <Button variant="secondary" size="sm" class="mt-2" onClick={handleClaimRefund}>
            Claim Refund
          </Button>
        </Show>
      </CardContent>
    </Card>
  );
}
