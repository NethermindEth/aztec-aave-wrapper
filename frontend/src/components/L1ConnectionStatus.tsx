/**
 * L1 Connection Status Component
 *
 * Displays Anvil L1 connection status with chain ID, block number, and connect button.
 * Uses Card and Badge components for consistent styling.
 */

import { createSignal, onCleanup, Show } from "solid-js";
import { createL1PublicClient, verifyL1Connection } from "../services/l1/client.js";
import { useApp } from "../store/hooks.js";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

/**
 * Polling interval for block number updates (in milliseconds)
 */
const BLOCK_POLL_INTERVAL = 4000;

/**
 * L1ConnectionStatus displays the current Anvil L1 connection state.
 *
 * Features:
 * - Connection status badge (connected/disconnected)
 * - Chain ID display
 * - Block number with automatic polling updates
 * - Connect button to establish connection
 *
 * @example
 * ```tsx
 * <L1ConnectionStatus />
 * ```
 */
export function L1ConnectionStatus() {
  const { state, actions } = useApp();
  const [isConnecting, setIsConnecting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  let pollInterval: ReturnType<typeof setInterval> | undefined;

  /**
   * Poll for block number updates when connected
   */
  const startBlockPolling = () => {
    if (pollInterval) {
      clearInterval(pollInterval);
    }

    const publicClient = createL1PublicClient();

    pollInterval = setInterval(async () => {
      try {
        const blockNumber = await publicClient.getBlockNumber();
        actions.setL1BlockNumber(Number(blockNumber));
      } catch (err) {
        console.error("Failed to fetch L1 block number:", err);
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
      const publicClient = createL1PublicClient();
      const chainId = await verifyL1Connection(publicClient);
      const blockNumber = await publicClient.getBlockNumber();

      actions.setL1Connection({
        connected: true,
        chainId,
        blockNumber: Number(blockNumber),
      });

      // Start polling for block updates
      startBlockPolling();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection failed";
      setError(message);
      actions.setL1Connection({ connected: false });
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <Card>
      <CardHeader class="pb-2">
        <div class="flex items-center justify-between">
          <CardTitle class="text-lg">L1 (Anvil)</CardTitle>
          <Badge variant={state.l1.connected ? "default" : "secondary"}>
            {state.l1.connected ? "Connected" : "Disconnected"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Show
          when={state.l1.connected}
          fallback={
            <div class="space-y-3">
              <Show when={error()}>
                <p class="text-sm text-destructive">{error()}</p>
              </Show>
              <Button onClick={handleConnect} disabled={isConnecting()} class="w-full">
                {isConnecting() ? "Connecting..." : "Connect to L1"}
              </Button>
            </div>
          }
        >
          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-muted-foreground">Chain ID</span>
              <span class="font-mono">{state.l1.chainId}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">Block</span>
              <span class="font-mono">{state.l1.blockNumber}</span>
            </div>
          </div>
        </Show>
      </CardContent>
    </Card>
  );
}
