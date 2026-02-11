/**
 * PendingWithdrawals Component
 *
 * Displays pending withdrawals that are in transit (L1 executed, tokens bridging to L2).
 * Each withdrawal shows amount, intent ID, status, and an optional "Claim Refund" button
 * for expired withdrawals.
 *
 * Mirrors the PendingDeposits component pattern — positions with PendingWithdraw status
 * are shown here instead of in the main PositionsList.
 */

import { IntentStatus } from "@aztec-aave-wrapper/shared";
import { createMemo, For, Show } from "solid-js";
import type { BusyState } from "~/app/controller/useBusy";
import { type Position, usePositions } from "../hooks/usePositions.js";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export interface PendingWithdrawalsProps {
  /** Callback when refund is requested for an expired pending withdrawal */
  onClaimRefund?: (intentId: string, deadline: bigint, shares: bigint, assetId: string) => void;
  /** Current L1 timestamp for deadline comparison */
  currentL1Timestamp?: bigint;
  /** Busy state for disabling buttons during in-flight operations */
  busy?: BusyState;
  /** Optional: CSS class for the container */
  class?: string;
}

function formatShares(shares: bigint): string {
  const DECIMALS = 6n;
  const SCALE = 10n ** DECIMALS;
  const wholePart = shares / SCALE;
  const decimalPart = shares % SCALE;
  const decimalStr = decimalPart.toString().padStart(Number(DECIMALS), "0");
  return `${wholePart}.${decimalStr}`;
}

function canClaimRefund(position: Position, currentL1Timestamp?: bigint): boolean {
  if (!currentL1Timestamp) return false;
  if (position.deadline === 0n) return false;
  return currentL1Timestamp >= position.deadline;
}

export function PendingWithdrawals(props: PendingWithdrawalsProps) {
  const { positions } = usePositions();

  const pendingWithdrawals = createMemo(() =>
    positions().filter((p) => p.status === IntentStatus.PendingWithdraw)
  );

  const hasWithdrawals = () => pendingWithdrawals().length > 0;

  return (
    <Show when={hasWithdrawals()}>
      <Card class={props.class}>
        <CardHeader class="pb-3">
          <div class="flex items-center justify-between">
            <CardTitle class="text-lg">Pending Withdrawals</CardTitle>
            <Badge class="bg-blue-500/20 text-blue-400 border-blue-500/30">
              {pendingWithdrawals().length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent class="space-y-2">
          <For each={pendingWithdrawals()}>
            {(position) => {
              const isExpired = () => canClaimRefund(position, props.currentL1Timestamp);
              const isClaiming = () => props.busy?.claimingRefund ?? false;

              return (
                <div class="pending-withdrawal-row">
                  <div class="space-y-1 min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span class="font-mono text-sm">{formatShares(position.shares)} aUSDC</span>
                      <Badge class="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">
                        Withdrawing
                      </Badge>
                    </div>
                    <div class="text-xs text-muted-foreground">
                      Intent: {position.intentId.slice(0, 12)}...
                    </div>
                    <Show when={!isExpired()}>
                      <div class="text-xs text-muted-foreground italic">
                        Tokens deposited to L2. Check "Pending Bridge Claims" to claim.
                      </div>
                    </Show>
                    <Show when={isExpired()}>
                      <div class="text-xs text-amber-400/80 italic">
                        Withdrawal expired. You can reclaim your shares.
                      </div>
                    </Show>
                    <div class="text-[10px] text-muted-foreground/60 mt-1">
                      Having issues? Use <strong>Troubleshoot Intent</strong> below to investigate.
                    </div>
                  </div>
                  <Show when={isExpired() && props.onClaimRefund}>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        props.onClaimRefund?.(
                          position.intentId,
                          position.deadline,
                          position.shares,
                          position.assetId
                        )
                      }
                      disabled={isClaiming()}
                    >
                      <Show when={isClaiming()} fallback="Claim Refund">
                        <span class="btn-spinner" /> Claiming...
                      </Show>
                    </Button>
                  </Show>
                </div>
              );
            }}
          </For>
        </CardContent>
      </Card>
    </Show>
  );
}
