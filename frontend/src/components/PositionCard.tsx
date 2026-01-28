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
  /** Callback when finalize button is clicked for pending deposits */
  onFinalizeDeposit?: (intentId: string) => void;
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

  // Check if this is a pending deposit that can be finalized
  // Finalization is allowed when:
  // 1. Status is PendingDeposit
  // 2. Deadline has NOT passed (deposit hasn't expired)
  // 3. onFinalizeDeposit callback is provided
  // Note: We don't check hasStoredSecret here - we'll handle that during finalization
  const canFinalize = () => {
    if (props.position.status !== IntentStatus.PendingDeposit) return false;
    if (!props.onFinalizeDeposit) return false;
    // If we have timestamp and deadline, check it hasn't expired
    if (props.currentL1Timestamp && props.position.deadline > 0n) {
      if (props.currentL1Timestamp > props.position.deadline) return false;
    }
    return true;
  };

  const handleFinalize = () => {
    if (props.onFinalizeDeposit && canFinalize()) {
      props.onFinalizeDeposit(props.position.intentId);
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
    <div class={`position-card ${props.class ?? ""}`}>
      {/* Header with position ID and status badge */}
      <div class="position-header">
        <span class="position-id">#{props.position.intentId.slice(0, 8)}...</span>
        <Badge variant={statusVariant()}>{statusLabel()}</Badge>
      </div>

      {/* Position info with token icon and amount */}
      <div class="position-info">
        <div class="position-token-icon usdc" aria-label="USDC token">
          {/* USDC logo inline SVG - avoids external asset dependency */}
          <svg
            width="32"
            height="32"
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <circle cx="16" cy="16" r="16" fill="#2775CA" />
            <path
              d="M20.5 18.5C20.5 20.43 18.89 22 16.5 22.32V24H15V22.31C12.9 22.03 11.5 20.7 11.5 18.8H13.5C13.5 19.8 14.35 20.5 15.75 20.5C17.08 20.5 18 19.85 18 18.85C18 17.95 17.4 17.5 15.92 17.13L14.92 16.88C12.77 16.35 11.5 15.22 11.5 13.45C11.5 11.55 13.05 10.08 15 9.72V8H16.5V9.73C18.45 10.05 19.87 11.38 19.87 13.2H17.87C17.87 12.2 17.08 11.5 15.75 11.5C14.5 11.5 13.67 12.1 13.67 13.05C13.67 13.88 14.27 14.37 15.67 14.72L16.67 14.97C19.05 15.55 20.5 16.6 20.5 18.5Z"
              fill="white"
            />
          </svg>
        </div>
        <div class="position-amount">
          <div class="position-amount-value">{formatShares(props.position.shares)}</div>
          <div class="position-amount-symbol">aUSDC</div>
        </div>
        {/* APY display placeholder - will be populated when data is available */}
        <div class="position-apy">
          <span class="position-apy-label">APY</span>
          <span class="position-apy-value">--</span>
        </div>
      </div>

      {/* Status message for pending deposits */}
      <Show when={props.position.status === IntentStatus.PendingDeposit && canFinalize()}>
        <p class="position-status-message">
          L1 deposit complete. Click "Finalize Deposit" to create your position.
        </p>
      </Show>

      {/* Status message for pending withdrawals */}
      <Show when={props.position.status === IntentStatus.PendingWithdraw && !canClaimRefund()}>
        <p class="position-status-message">
          Tokens deposited to L2. Check "Pending Bridge Claims" to claim.
        </p>
      </Show>

      {/* Action buttons */}
      <Show
        when={
          props.position.status === IntentStatus.Confirmed ||
          canCancel() ||
          canFinalize() ||
          canClaimRefund()
        }
      >
        <div class="position-actions">
          <Show when={props.position.status === IntentStatus.Confirmed}>
            <Button class="btn-cta" onClick={() => props.onWithdraw(props.position.intentId)}>
              Withdraw
            </Button>
          </Show>
          <Show when={canFinalize()}>
            <Button class="btn-cta" onClick={handleFinalize}>
              Finalize Deposit
            </Button>
          </Show>
          <Show when={canCancel()}>
            <Button variant="destructive" class="btn-cta" onClick={handleCancel}>
              Cancel Deposit
            </Button>
          </Show>
          <Show when={canClaimRefund()}>
            <Button variant="secondary" class="btn-cta" onClick={handleClaimRefund}>
              Claim Refund
            </Button>
          </Show>
        </div>
      </Show>
    </div>
  );
}
