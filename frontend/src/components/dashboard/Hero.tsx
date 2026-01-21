/**
 * Hero Section Component
 *
 * Displays the main title and tagline for the application.
 * Optionally shows portfolio stats when positions exist.
 */

import type { Component } from "solid-js";
import { Show } from "solid-js";
import { formatAmount } from "../../shared/format/usdc";

interface HeroProps {
  /** Total value locked across all active positions */
  totalValueLocked?: bigint;
  /** Number of active positions */
  activePositionCount?: number;
  /** Number of bridge claims ready to process */
  readyClaimsCount?: number;
}

export const Hero: Component<HeroProps> = (props) => {
  const hasStats = () =>
    props.totalValueLocked !== undefined &&
    props.activePositionCount !== undefined &&
    (props.totalValueLocked > 0n || props.activePositionCount > 0);

  return (
    <section class="text-center py-6">
      <h1 class="text-2xl font-semibold tracking-tight text-zinc-100">
        Privacy-Preserving Lending
      </h1>
      <p class="text-sm text-zinc-500 mt-1.5 max-w-md mx-auto">
        Deposit into Aave V3 from Aztec L2 while keeping your identity private
      </p>

      {/* Portfolio stats - shown when user has positions */}
      <Show when={hasStats()}>
        <div class="mt-4 flex justify-center gap-6">
          <div class="text-center">
            <p class="text-xs text-zinc-500 uppercase tracking-wider">Total Value</p>
            <p class="text-lg font-medium text-zinc-200">
              ${formatAmount(props.totalValueLocked || 0n)}
            </p>
          </div>
          <div class="text-center">
            <p class="text-xs text-zinc-500 uppercase tracking-wider">Positions</p>
            <p class="text-lg font-medium text-zinc-200">{props.activePositionCount}</p>
          </div>
          <Show when={(props.readyClaimsCount || 0) > 0}>
            <div class="text-center">
              <p class="text-xs text-zinc-500 uppercase tracking-wider">Ready Claims</p>
              <p class="text-lg font-medium text-emerald-400">{props.readyClaimsCount}</p>
            </div>
          </Show>
        </div>
      </Show>
    </section>
  );
};
