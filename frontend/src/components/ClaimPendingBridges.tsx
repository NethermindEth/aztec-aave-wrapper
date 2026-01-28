/**
 * ClaimPendingBridges Component
 *
 * Displays pending bridge operations that need L2 claiming and allows users
 * to claim their bridged tokens once the L1→L2 message has synced.
 *
 * Bridges are derived from on-chain data (L1 events + L2 message status)
 * and matched with locally stored secrets.
 */

import { For, Show } from "solid-js";
import type { PendingBridge, PendingBridgeStatus } from "../services/pendingBridges.js";
import { formatBalance } from "./BalanceDisplay.js";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

/**
 * Props for ClaimPendingBridges component
 */
export interface ClaimPendingBridgesProps {
  /** Array of pending bridges (derived from chain state) */
  bridges: PendingBridge[];
  /** Whether bridges are currently being loaded */
  isLoading?: boolean;
  /** Callback to claim a bridge */
  onClaim?: (bridge: PendingBridge) => Promise<void>;
  /** Callback to refresh/rescan bridges */
  onRefresh?: () => Promise<void>;
  /** Currently claiming bridge messageKey (for loading state) */
  claimingKey?: string | null;
  /** Error message to display */
  error?: string | null;
  /** Whether wallet is connected (to show scan button) */
  walletConnected?: boolean;
  /** Optional: CSS class for the container */
  class?: string;
}

/**
 * Format L2 sync progress for display
 * Shows current block vs target block when available
 */
function formatSyncProgress(bridge: PendingBridge): string {
  if (bridge.currentL2Block !== undefined && bridge.targetL2Block !== undefined) {
    return `L2 Block ${bridge.currentL2Block.toString()} / ${bridge.targetL2Block.toString()}`;
  }
  if (bridge.currentL2Block !== undefined) {
    return `L2 Block ${bridge.currentL2Block.toString()}`;
  }
  // Fallback to L1 block
  return `L1 Block ${bridge.l1BlockNumber.toString()}`;
}

/**
 * Get status badge color based on bridge status
 */
function getStatusColor(status: PendingBridgeStatus): string {
  switch (status) {
    case "pending":
      return "bg-yellow-500/20 text-yellow-600";
    case "ready":
      return "bg-green-500/20 text-green-600";
    case "unknown":
      return "bg-gray-500/20 text-gray-600";
    default:
      return "bg-gray-500/20 text-gray-600";
  }
}

/**
 * Get human-readable status text
 */
function getStatusText(status: PendingBridgeStatus): string {
  switch (status) {
    case "pending":
      return "Waiting for sync";
    case "ready":
      return "Ready to claim";
    case "unknown":
      return "Checking...";
    default:
      return status;
  }
}

/**
 * ClaimPendingBridges renders a list of pending bridge operations
 * that need L2 claiming.
 */
export function ClaimPendingBridges(props: ClaimPendingBridgesProps) {
  const hasBridges = () => props.bridges.length > 0;
  const shouldShow = () => props.walletConnected || hasBridges() || props.isLoading;

  const handleClaim = async (bridge: PendingBridge) => {
    if (props.onClaim) {
      await props.onClaim(bridge);
    }
  };

  return (
    <Show when={shouldShow()}>
      <Card class={props.class}>
        <CardHeader class="pb-3">
          <CardTitle class="text-lg">Pending Bridge Claims</CardTitle>
        </CardHeader>
        <CardContent class="space-y-3">
          {/* Error Alert */}
          <Show when={props.error}>
            <Alert variant="destructive">
              <AlertDescription>{props.error}</AlertDescription>
            </Alert>
          </Show>

          {/* Loading State */}
          <Show when={props.isLoading}>
            <div class="text-center text-muted-foreground py-4">
              Scanning L1 events and checking L2 message status...
            </div>
          </Show>

          {/* No bridges found */}
          <Show when={!props.isLoading && !hasBridges()}>
            <div class="text-center text-muted-foreground py-4">
              <p>No pending bridges found.</p>
            </div>
          </Show>

          {/* Bridge List */}
          <Show when={hasBridges()}>
            <Alert>
              <AlertDescription class="text-sm">
                These bridges completed on L1 but still need claiming on L2.
              </AlertDescription>
            </Alert>
            <div class="space-y-2">
              <For each={props.bridges}>
                {(bridge) => (
                  <div class="flex items-center justify-between p-3 rounded-lg border bg-card">
                    <div class="space-y-1">
                      <div class="flex items-center gap-2">
                        <span class="font-mono text-sm">
                          {formatBalance(bridge.amount, 6)} USDC
                        </span>
                        <span
                          class={`text-xs px-2 py-0.5 rounded-full ${getStatusColor(bridge.status)}`}
                        >
                          {getStatusText(bridge.status)}
                        </span>
                      </div>
                      <div class="text-xs text-muted-foreground">
                        {formatSyncProgress(bridge)} &middot; {bridge.messageKey.slice(0, 12)}...
                      </div>
                      <Show when={bridge.leafIndex !== undefined}>
                        <div class="text-xs text-green-500">
                          L2 leaf index: {bridge.leafIndex?.toString()}
                        </div>
                      </Show>
                    </div>
                    <div class="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleClaim(bridge)}
                        disabled={
                          props.claimingKey === bridge.messageKey || bridge.status !== "ready"
                        }
                      >
                        {props.claimingKey === bridge.messageKey
                          ? "Claiming..."
                          : bridge.status === "ready"
                            ? "Claim"
                            : "Not Ready"}
                      </Button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </CardContent>
      </Card>
    </Show>
  );
}
