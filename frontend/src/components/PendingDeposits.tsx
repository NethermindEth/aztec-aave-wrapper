/**
 * PendingDeposits Component
 *
 * Displays pending two-phase deposits that need L1 execution.
 * Each deposit shows amount, intent ID, proof status, time since creation,
 * and an "Execute on L1" button enabled only when proof status is 'ready'.
 */

import { For, Show } from "solid-js";
import type { PendingDepositEntry } from "../app/controller/usePendingDeposits.js";
import type { DepositProofStatus } from "../services/depositProofPoller.js";
import { formatBalance } from "./BalanceDisplay.js";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export interface PendingDepositsProps {
  /** Array of pending deposits with proof status */
  deposits: PendingDepositEntry[];
  /** Whether deposits are currently being loaded */
  isLoading?: boolean;
  /** Intent ID currently being executed */
  executingIntentId?: string | null;
  /** Error message to display */
  error?: string | null;
  /** Callback when user clicks "Execute on L1" */
  onExecute?: (intentId: string) => void;
  /** Callback to refresh deposits */
  onRefresh?: () => void;
  /** Optional: CSS class for the container */
  class?: string;
}

function getStatusBadgeClass(
  status: DepositProofStatus | "unknown",
  isExecuting: boolean,
): string {
  if (isExecuting) {
    return "bg-blue-500/20 text-blue-600 border-blue-500/30";
  }
  switch (status) {
    case "waiting_for_proof":
    case "waiting_for_checkpoint":
      return "bg-yellow-500/20 text-yellow-600 border-yellow-500/30";
    case "ready":
      return "bg-green-500/20 text-green-600 border-green-500/30";
    case "error":
      return "bg-red-500/20 text-red-600 border-red-500/30";
    default:
      return "bg-gray-500/20 text-gray-600 border-gray-500/30";
  }
}

function getStatusText(
  status: DepositProofStatus | "unknown",
  isExecuting: boolean,
): string {
  if (isExecuting) {
    return "Executing...";
  }
  switch (status) {
    case "waiting_for_proof":
      return "Waiting for proof";
    case "waiting_for_checkpoint":
      return "Waiting for checkpoint";
    case "ready":
      return "Ready";
    case "error":
      return "Error";
    default:
      return "Checking...";
  }
}

function formatTimeSince(createdAt: number): string {
  const elapsed = Date.now() - createdAt;
  const seconds = Math.floor(elapsed / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function PendingDeposits(props: PendingDepositsProps) {
  const hasDeposits = () => props.deposits.length > 0;

  return (
    <Show when={hasDeposits() || props.isLoading}>
      <Card class={props.class}>
        <CardHeader class="pb-3">
          <div class="flex items-center justify-between">
            <CardTitle class="text-lg">Pending Deposits</CardTitle>
            <Show when={props.onRefresh}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => props.onRefresh?.()}
                disabled={props.isLoading}
              >
                {props.isLoading ? "Refreshing..." : "Refresh"}
              </Button>
            </Show>
          </div>
        </CardHeader>
        <CardContent class="space-y-3">
          {/* Error Alert */}
          <Show when={props.error}>
            <Alert variant="destructive">
              <AlertDescription>{props.error}</AlertDescription>
            </Alert>
          </Show>

          {/* Loading State */}
          <Show when={props.isLoading && !hasDeposits()}>
            <div class="text-center text-muted-foreground py-4">
              Loading pending deposits...
            </div>
          </Show>

          {/* Deposit List */}
          <Show when={hasDeposits()}>
            <div class="space-y-2">
              <For each={props.deposits}>
                {(entry) => {
                  const isExecuting = () =>
                    props.executingIntentId === entry.deposit.intentId;

                  return (
                    <div class="flex items-center justify-between p-3 rounded-lg border bg-card">
                      <div class="space-y-1">
                        <div class="flex items-center gap-2">
                          <span class="font-mono text-sm">
                            {formatBalance(entry.deposit.amount, 6)} USDC
                          </span>
                          <Badge
                            class={getStatusBadgeClass(
                              entry.proofStatus,
                              isExecuting(),
                            )}
                          >
                            {getStatusText(entry.proofStatus, isExecuting())}
                          </Badge>
                        </div>
                        <div class="text-xs text-muted-foreground">
                          Intent: {entry.deposit.intentId.slice(0, 12)}...
                          &middot; {formatTimeSince(entry.deposit.createdAt)}
                        </div>
                        <Show when={entry.proofMessage && entry.proofStatus !== "ready"}>
                          <div class="text-xs text-muted-foreground italic">
                            {entry.proofMessage}
                          </div>
                        </Show>
                      </div>
                      <div class="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            props.onExecute?.(entry.deposit.intentId)
                          }
                          disabled={
                            isExecuting() || entry.proofStatus !== "ready"
                          }
                        >
                          {isExecuting()
                            ? "Executing..."
                            : entry.proofStatus === "ready"
                              ? "Execute on L1"
                              : "Not Ready"}
                        </Button>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </CardContent>
      </Card>
    </Show>
  );
}
