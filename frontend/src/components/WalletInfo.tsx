/**
 * Wallet Info Component
 *
 * Displays L1 and L2 wallet addresses with USDC and aToken balances.
 * Uses Card component for consistent styling.
 */

import { Show } from "solid-js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { useApp } from "../store/hooks.js";
import { formatUSDCFromString } from "../types/state.js";

/**
 * Truncate an address for display
 * Shows first 6 and last 4 characters: 0x1234...abcd
 */
function truncateAddress(address: string): string {
  if (address.length <= 13) {
    return address;
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * WalletInfo displays wallet addresses and token balances.
 *
 * Features:
 * - L1 (Ethereum) wallet address display
 * - L2 (Aztec) wallet address display
 * - USDC balance (6 decimals)
 * - aToken balance (6 decimals)
 * - Address truncation for cleaner display
 *
 * @example
 * ```tsx
 * <WalletInfo />
 * ```
 */
export function WalletInfo() {
  const { state } = useApp();

  const hasWallet = () => state.wallet.l1Address || state.wallet.l2Address;

  return (
    <Card>
      <CardHeader class="pb-2">
        <CardTitle class="text-lg">Wallet</CardTitle>
      </CardHeader>
      <CardContent>
        <Show
          when={hasWallet()}
          fallback={
            <p class="text-sm text-muted-foreground">
              No wallet connected
            </p>
          }
        >
          <div class="space-y-4">
            <div class="space-y-2 text-sm">
              <Show when={state.wallet.l1Address}>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">L1 Address</span>
                  <span class="font-mono" title={state.wallet.l1Address!}>
                    {truncateAddress(state.wallet.l1Address!)}
                  </span>
                </div>
              </Show>
              <Show when={state.wallet.l2Address}>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">L2 Address</span>
                  <span class="font-mono" title={state.wallet.l2Address!}>
                    {truncateAddress(state.wallet.l2Address!)}
                  </span>
                </div>
              </Show>
            </div>

            <div class="border-t pt-4 space-y-2 text-sm">
              <div class="flex justify-between">
                <span class="text-muted-foreground">USDC Balance</span>
                <span class="font-mono">
                  {formatUSDCFromString(state.wallet.usdcBalance)} USDC
                </span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">aToken Balance</span>
                <span class="font-mono">
                  {formatUSDCFromString(state.wallet.aTokenBalance)} aUSDC
                </span>
              </div>
            </div>
          </div>
        </Show>
      </CardContent>
    </Card>
  );
}
