/**
 * Connection Status Bar Component
 *
 * Combines L1 and L2 connection status components in a horizontal bar layout.
 * Provides visual indication when both connections are required for operations.
 */

import { Show } from "solid-js";
import { useApp } from "../store/hooks.js";
import { L1ConnectionStatus } from "./L1ConnectionStatus";
import { L2ConnectionStatus } from "./L2ConnectionStatus";

/**
 * ConnectionStatusBar displays L1 and L2 connection status side by side.
 *
 * Features:
 * - Horizontal flex layout with L1 and L2 status cards
 * - Responsive: stacks vertically on narrow screens
 * - Shows warning when both connections are required but not established
 *
 * @example
 * ```tsx
 * <ConnectionStatusBar />
 * ```
 */
export function ConnectionStatusBar() {
  const { state } = useApp();

  const bothConnected = () => state.l1.connected && state.l2.connected;

  return (
    <div class="space-y-3">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <L1ConnectionStatus />
        <L2ConnectionStatus />
      </div>
      <Show when={!bothConnected()}>
        <p class="text-sm text-muted-foreground text-center">
          Both L1 and L2 connections are required to perform operations.
        </p>
      </Show>
    </div>
  );
}
