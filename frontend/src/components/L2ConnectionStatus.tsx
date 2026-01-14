/**
 * L2 Connection Status Component
 *
 * Displays Aztec sandbox connection status with node version and connect button.
 * Uses Card and Badge components for consistent styling.
 */

import { createSignal, onCleanup, Show } from "solid-js";
import {
  type AztecNodeClient,
  createL2NodeClient,
  verifyL2Connection,
} from "../services/l2/client.js";
import { useApp } from "../store/hooks.js";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

/**
 * Polling interval for block number updates (in milliseconds)
 */
const BLOCK_POLL_INTERVAL = 4000;

/**
 * L2ConnectionStatus displays the current Aztec sandbox connection state.
 *
 * Features:
 * - Connection status badge (connected/disconnected)
 * - Node version display
 * - Block number with automatic polling updates
 * - Connect button to establish connection
 *
 * @example
 * ```tsx
 * <L2ConnectionStatus />
 * ```
 */
export function L2ConnectionStatus() {
  const { state, actions } = useApp();
  const [isConnecting, setIsConnecting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  let pollInterval: ReturnType<typeof setInterval> | undefined;
  let nodeClient: AztecNodeClient | undefined;

  /**
   * Poll for block number updates when connected
   */
  const startBlockPolling = () => {
    if (pollInterval) {
      clearInterval(pollInterval);
    }

    if (!nodeClient) {
      return;
    }

    pollInterval = setInterval(async () => {
      try {
        if (nodeClient) {
          const blockNumber = await nodeClient.getBlockNumber();
          actions.setL2BlockNumber(blockNumber);
        }
      } catch (err) {
        console.error("Failed to fetch L2 block number:", err);
      }
    }, BLOCK_POLL_INTERVAL);
  };

  /**
   * Stop block number polling
   */
  const stopBlockPolling = () => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = undefined;
    }
  };

  // Cleanup polling on component unmount
  onCleanup(() => {
    stopBlockPolling();
  });

  /**
   * Handle connect button click
   */
  const handleConnect = async () => {
    setIsConnecting(true);
    setError(null);

    try {
      nodeClient = await createL2NodeClient();
      const nodeInfo = await verifyL2Connection(nodeClient);
      const blockNumber = await nodeClient.getBlockNumber();

      actions.setL2Connection({
        connected: true,
        nodeVersion: nodeInfo.nodeVersion,
        blockNumber,
      });

      // Start polling for block updates
      startBlockPolling();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection failed";
      setError(message);
      actions.setL2Connection({ connected: false });
      nodeClient = undefined;
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <Card>
      <CardHeader class="pb-2">
        <div class="flex items-center justify-between">
          <CardTitle class="text-lg">L2 (Aztec)</CardTitle>
          <Badge variant={state.l2.connected ? "default" : "secondary"}>
            {state.l2.connected ? "Connected" : "Disconnected"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Show
          when={state.l2.connected}
          fallback={
            <div class="space-y-3">
              <Show when={error()}>
                <p class="text-sm text-destructive">{error()}</p>
              </Show>
              <Button onClick={handleConnect} disabled={isConnecting()} class="w-full">
                {isConnecting() ? "Connecting..." : "Connect to L2"}
              </Button>
            </div>
          }
        >
          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-muted-foreground">Node Version</span>
              <span class="font-mono text-xs">{state.l2.nodeVersion}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">Block</span>
              <span class="font-mono">{state.l2.blockNumber}</span>
            </div>
          </div>
        </Show>
      </CardContent>
    </Card>
  );
}
