/**
 * WalletBalances Component
 *
 * Displays connected wallet token balances across L1 and L2 chains.
 * Shows L1 USDC, L2 USDC (bridged token), and AAVE aToken balances.
 * Features a financial terminal aesthetic with live balance updates.
 */

import type { AztecAddress } from "@aztec-aave-wrapper/shared";
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import type { Address, Chain, PublicClient, Transport } from "viem";
import { balanceOf } from "../services/l1/tokens.js";
import { useApp } from "../store/hooks.js";
import { fromBigIntString } from "../types/state.js";
import { formatBalance } from "./BalanceDisplay.js";

/**
 * Props for WalletBalances component
 */
export interface WalletBalancesProps {
  /** L1 wallet address */
  l1Address: Address | null;
  /** L2 wallet address */
  l2Address: AztecAddress | null;
  /** Viem public client for L1 reads */
  publicClient: PublicClient<Transport, Chain> | null;
  /** Mock USDC token address on L1 */
  mockUsdcAddress: Address | null;
  /** Mock aToken address (from lending pool) */
  mockLendingPoolAddress: Address | null;
  /** L2 bridged token address (USDC on Aztec) */
  l2BridgedTokenAddress: AztecAddress | null;
  /** Optional: CSS class for container */
  class?: string;
}

/**
 * Individual token balance data
 */
interface TokenBalance {
  id: string;
  label: string;
  symbol: string;
  balance: bigint;
  chain: "L1" | "L2";
  gradient: string;
  iconBg: string;
}

/**
 * Minimal ABI for aToken balance check (shares held by portal)
 * aTokens represent the user's position in the lending pool
 */
const ATOKEN_ABI = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

/**
 * WalletBalances renders a live token balance display for connected wallets.
 *
 * Features:
 * - L1/L2 column layout showing balances per chain
 * - Token-specific gradient styling (USDC blue, aToken purple)
 * - Auto-refresh balances on interval
 * - Shimmer loading effect during updates
 */
export function WalletBalances(props: WalletBalancesProps) {
  const { state } = useApp();
  const [balances, setBalances] = createSignal<TokenBalance[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [lastUpdated, setLastUpdated] = createSignal<Date | null>(null);

  // Auto-refresh interval
  let refreshInterval: ReturnType<typeof setInterval> | undefined;

  // Check if component should be visible
  const isVisible = () =>
    (props.l1Address !== null && props.publicClient !== null) || props.l2Address !== null;

  /**
   * Fetch all token balances
   */
  const fetchBalances = async () => {
    const newBalances: TokenBalance[] = [];

    // Fetch L1 balances if connected
    if (props.l1Address && props.publicClient) {
      // L1 USDC balance
      if (props.mockUsdcAddress) {
        try {
          const usdcBalance = await balanceOf(
            props.publicClient,
            props.mockUsdcAddress,
            props.l1Address
          );
          newBalances.push({
            id: "l1-usdc",
            label: "L1 USDC",
            symbol: "USDC",
            balance: usdcBalance,
            chain: "L1",
            gradient: "from-blue-500/20 to-cyan-500/20",
            iconBg: "bg-gradient-to-br from-blue-500 to-blue-600",
          });
        } catch (err) {
          console.warn("Failed to fetch L1 USDC balance:", err);
        }
      }

      // aToken balance (user's Aave position represented by aTokens)
      // Note: In the portal architecture, aTokens are held by the portal contract,
      // not directly by users. We query the lending pool for the user's share.
      if (props.mockLendingPoolAddress && props.mockUsdcAddress) {
        try {
          // The mock lending pool returns aTokens to depositors
          // For demo purposes, we check the user's aToken balance if they have any direct holdings
          // In production, the actual position is tracked via the portal's share accounting
          const aTokenBalance = await props.publicClient.readContract({
            address: props.mockLendingPoolAddress,
            abi: ATOKEN_ABI,
            functionName: "balanceOf",
            args: [props.l1Address],
          });

          // Only show if user has direct aToken holdings (outside portal)
          if (aTokenBalance > 0n) {
            newBalances.push({
              id: "l1-atoken",
              label: "aUSDC",
              symbol: "aUSDC",
              balance: aTokenBalance,
              chain: "L1",
              gradient: "from-purple-500/20 to-pink-500/20",
              iconBg: "bg-gradient-to-br from-purple-500 to-pink-500",
            });
          }
        } catch {
          // aToken balance check failed - this is expected if the lending pool
          // doesn't have a standard balanceOf for users
        }
      }
    }

    // L2 USDC balance from store (set by useL2Positions via on-chain BridgedToken.balance_of_private)
    if (props.l2Address && props.l2BridgedTokenAddress) {
      const l2Balance = fromBigIntString(state.wallet.l2UsdcBalance);
      newBalances.push({
        id: "l2-usdc",
        label: "L2 USDC",
        symbol: "USDC",
        balance: l2Balance,
        chain: "L2",
        gradient: "from-emerald-500/20 to-teal-500/20",
        iconBg: "bg-gradient-to-br from-emerald-500 to-teal-500",
      });
    }

    setBalances(newBalances);
    setLastUpdated(new Date());
    setIsLoading(false);
  };

  // Fetch balances when dependencies change
  createEffect(
    on(
      () => [
        props.l1Address,
        props.publicClient,
        props.mockUsdcAddress,
        state.wallet.l2UsdcBalance,
      ],
      () => {
        if (isVisible()) {
          setIsLoading(true);
          fetchBalances();
        }
      }
    )
  );

  // Set up auto-refresh every 15 seconds
  createEffect(() => {
    if (isVisible()) {
      refreshInterval = setInterval(() => {
        fetchBalances();
      }, 15000);
    }

    onCleanup(() => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
    });
  });

  // Format time since last update
  const timeSinceUpdate = () => {
    const last = lastUpdated();
    if (!last) return "";
    const seconds = Math.floor((Date.now() - last.getTime()) / 1000);
    if (seconds < 5) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    return `${Math.floor(seconds / 60)}m ago`;
  };

  return (
    <Show when={isVisible()}>
      <div
        class={`wallet-balances relative overflow-hidden rounded-xl border border-white/[0.06] bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 backdrop-blur-xl ${props.class || ""}`}
      >
        {/* Decorative top accent line */}
        <div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-purple-500/50 to-transparent" />

        {/* Header */}
        <div class="flex items-center justify-between px-5 py-3 border-b border-white/[0.04]">
          <div class="flex items-center gap-2.5">
            {/* Terminal-style icon */}
            <div class="flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500/20 to-cyan-500/20 border border-white/[0.08]">
              <svg
                class="w-3.5 h-3.5 text-purple-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                />
              </svg>
            </div>
            <span class="text-sm font-medium text-zinc-300 tracking-tight">Wallet Balances</span>
          </div>

          {/* Refresh indicator */}
          <div class="flex items-center gap-2">
            <Show when={lastUpdated()}>
              <span class="text-[10px] font-mono text-zinc-600 uppercase tracking-wider">
                {timeSinceUpdate()}
              </span>
            </Show>
            <button
              type="button"
              onClick={() => {
                setIsLoading(true);
                fetchBalances();
              }}
              class="p-1.5 rounded-md hover:bg-white/[0.04] transition-colors group"
              title="Refresh balances"
            >
              <svg
                class={`w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-300 transition-all ${isLoading() ? "animate-spin" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Balance Grid */}
        <div class="p-4">
          <Show
            when={balances().length > 0}
            fallback={
              <div class="flex items-center justify-center py-6">
                <Show
                  when={isLoading()}
                  fallback={<span class="text-sm text-zinc-600">No tokens found</span>}
                >
                  <div class="flex items-center gap-2">
                    <div class="w-4 h-4 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
                    <span class="text-sm text-zinc-500">Loading balances...</span>
                  </div>
                </Show>
              </div>
            }
          >
            <div class="grid gap-2.5">
              <For each={balances()}>
                {(token) => (
                  <div
                    class={`token-balance-row group relative flex items-center gap-4 p-3.5 rounded-xl border border-white/[0.04] bg-gradient-to-r ${token.gradient} hover:border-white/[0.08] transition-all duration-200`}
                  >
                    {/* Token Icon */}
                    <div
                      class={`flex items-center justify-center w-10 h-10 rounded-xl ${token.iconBg} shadow-lg shadow-black/20`}
                    >
                      <span class="text-xs font-bold text-white tracking-tight">
                        {token.symbol.charAt(0)}
                      </span>
                    </div>

                    {/* Token Info */}
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="text-sm font-medium text-zinc-200">{token.label}</span>
                        <span
                          class={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${
                            token.chain === "L1"
                              ? "bg-blue-500/10 text-blue-400"
                              : "bg-emerald-500/10 text-emerald-400"
                          }`}
                        >
                          {token.chain}
                        </span>
                      </div>
                      <div class="text-xs text-zinc-500 mt-0.5">{token.symbol}</div>
                    </div>

                    {/* Balance */}
                    <div class="text-right">
                      <div
                        class={`text-lg font-mono font-semibold tabular-nums tracking-tight ${
                          isLoading() ? "text-zinc-500 animate-pulse" : "text-zinc-100"
                        }`}
                      >
                        {formatBalance(token.balance.toString(), 6)}
                      </div>
                      <div class="text-[10px] font-mono text-zinc-600 uppercase">
                        {token.symbol}
                      </div>
                    </div>

                    {/* Shimmer overlay during loading */}
                    <Show when={isLoading()}>
                      <div class="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
                        <div class="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/[0.03] to-transparent" />
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* Chain Legend */}
          <Show when={balances().length > 0}>
            <div class="flex items-center justify-center gap-4 mt-4 pt-3 border-t border-white/[0.04]">
              <div class="flex items-center gap-1.5">
                <div class="w-2 h-2 rounded-full bg-blue-500" />
                <span class="text-[10px] font-mono text-zinc-600 uppercase tracking-wider">
                  Ethereum L1
                </span>
              </div>
              <div class="flex items-center gap-1.5">
                <div class="w-2 h-2 rounded-full bg-emerald-500" />
                <span class="text-[10px] font-mono text-zinc-600 uppercase tracking-wider">
                  Aztec L2
                </span>
              </div>
            </div>
          </Show>
        </div>

        {/* Decorative corner accents */}
        <div class="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-purple-500/[0.03] to-transparent pointer-events-none" />
        <div class="absolute bottom-0 left-0 w-16 h-16 bg-gradient-to-tr from-cyan-500/[0.03] to-transparent pointer-events-none" />
      </div>
    </Show>
  );
}
