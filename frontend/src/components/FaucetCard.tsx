/**
 * FaucetCard Component
 *
 * Displays token faucet status and allows users to claim test tokens.
 * Shows cooldown timer, drip amount, and claim button with loading states.
 */

import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import type { Address, Chain, PublicClient, Transport, WalletClient, Account } from "viem";
import { formatBalance } from "./BalanceDisplay.js";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import {
  claim,
  formatCooldown,
  getClaimStatus,
  getFaucetConfig,
  type ClaimStatus,
  type FaucetConfig,
} from "../services/l1/faucet.js";

/**
 * Props for FaucetCard component
 */
export interface FaucetCardProps {
  /** Faucet contract address */
  faucetAddress: Address | null;
  /** User's L1 wallet address */
  userAddress: Address | null;
  /** Viem public client for reading contract state */
  publicClient: PublicClient<Transport, Chain> | null;
  /** Viem wallet client for signing transactions */
  walletClient: WalletClient<Transport, Chain, Account> | null;
  /** Callback after successful claim (to refresh balances) */
  onClaimSuccess?: () => void;
  /** Optional: CSS class for the container */
  class?: string;
}

/**
 * FaucetCard renders a card for claiming test tokens from the faucet.
 *
 * Features:
 * - Displays faucet drip amount
 * - Shows cooldown timer with live countdown
 * - Claim button with loading state
 * - Error handling and display
 */
export function FaucetCard(props: FaucetCardProps) {
  const [config, setConfig] = createSignal<FaucetConfig | null>(null);
  const [claimStatus, setClaimStatus] = createSignal<ClaimStatus | null>(null);
  const [isClaiming, setIsClaiming] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Timer for cooldown countdown
  let countdownInterval: ReturnType<typeof setInterval> | undefined;

  // Check if faucet is available
  const isAvailable = () =>
    props.faucetAddress !== null &&
    props.userAddress !== null &&
    props.publicClient !== null;

  // Check if user can claim
  const canClaim = () => {
    const status = claimStatus();
    return (
      isAvailable() &&
      props.walletClient !== null &&
      status?.claimable === true &&
      !isClaiming()
    );
  };

  // Format the drip amount for display (USDC has 6 decimals)
  const formattedDripAmount = () => {
    const cfg = config();
    if (!cfg) return "...";
    return formatBalance(cfg.dripAmount.toString(), 6);
  };

  // Format cooldown for display
  const formattedCooldown = () => {
    const status = claimStatus();
    if (!status) return "...";
    return formatCooldown(status.remainingCooldown);
  };

  // Load faucet config and status
  const loadFaucetData = async () => {
    if (!isAvailable()) return;

    setIsLoading(true);
    setError(null);

    try {
      const [faucetConfig, status] = await Promise.all([
        getFaucetConfig(props.publicClient!, props.faucetAddress!),
        getClaimStatus(props.publicClient!, props.faucetAddress!, props.userAddress!),
      ]);

      setConfig(faucetConfig);
      setClaimStatus(status);

      // Start countdown if there's remaining cooldown
      startCountdown(status.remainingCooldown);
    } catch (err) {
      console.error("Failed to load faucet data:", err);
      setError(err instanceof Error ? err.message : "Failed to load faucet data");
    } finally {
      setIsLoading(false);
    }
  };

  // Start countdown timer
  const startCountdown = (initialSeconds: bigint) => {
    // Clear any existing interval
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = undefined;
    }

    if (initialSeconds <= 0n) return;

    let remaining = initialSeconds;

    countdownInterval = setInterval(() => {
      remaining = remaining - 1n;

      if (remaining <= 0n) {
        // Cooldown expired, refresh status
        clearInterval(countdownInterval);
        countdownInterval = undefined;
        loadFaucetData();
      } else {
        // Update claim status with new remaining time
        setClaimStatus((prev) =>
          prev ? { ...prev, remainingCooldown: remaining, claimable: false } : null
        );
      }
    }, 1000);
  };

  // Handle claim button click
  const handleClaim = async () => {
    if (!canClaim() || !props.publicClient || !props.walletClient || !props.faucetAddress) {
      return;
    }

    setIsClaiming(true);
    setError(null);

    try {
      await claim(props.publicClient, props.walletClient, props.faucetAddress);

      // Refresh faucet status
      await loadFaucetData();

      // Notify parent to refresh balances
      props.onClaimSuccess?.();
    } catch (err) {
      console.error("Failed to claim tokens:", err);
      setError(err instanceof Error ? err.message : "Failed to claim tokens");
    } finally {
      setIsClaiming(false);
    }
  };

  // Load data when dependencies change
  createEffect(() => {
    if (isAvailable()) {
      loadFaucetData();
    }
  });

  // Cleanup interval on unmount
  onCleanup(() => {
    if (countdownInterval) {
      clearInterval(countdownInterval);
    }
  });

  // Only show if faucet is configured
  return (
    <Show when={props.faucetAddress}>
      <Card class={props.class}>
        <CardHeader class="pb-3">
          <CardTitle class="text-lg">Test Token Faucet</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          {/* Error Alert */}
          <Show when={error()}>
            <Alert variant="destructive">
              <AlertDescription>{error()}</AlertDescription>
            </Alert>
          </Show>

          {/* Loading State */}
          <Show when={isLoading()}>
            <div class="text-center text-muted-foreground py-4">Loading faucet status...</div>
          </Show>

          {/* Faucet Info */}
          <Show when={!isLoading() && config()}>
            <div class="space-y-3">
              {/* Drip Amount Info */}
              <div class="flex items-center justify-between p-3 rounded-lg border bg-card">
                <div class="space-y-1">
                  <div class="text-sm text-muted-foreground">Claim Amount</div>
                  <div class="font-mono text-lg">{formattedDripAmount()} USDC</div>
                </div>
                <div class="text-right space-y-1">
                  <div class="text-sm text-muted-foreground">Cooldown</div>
                  <div
                    class={`font-mono ${claimStatus()?.claimable ? "text-green-500" : "text-yellow-500"}`}
                  >
                    {formattedCooldown()}
                  </div>
                </div>
              </div>

              {/* Wallet not connected message */}
              <Show when={!props.userAddress}>
                <Alert>
                  <AlertDescription>Connect your wallet to claim test tokens.</AlertDescription>
                </Alert>
              </Show>

              {/* Claim Button */}
              <Show when={props.userAddress}>
                <Button
                  class="w-full"
                  onClick={handleClaim}
                  disabled={!canClaim() || isClaiming()}
                >
                  {isClaiming()
                    ? "Claiming..."
                    : claimStatus()?.claimable
                      ? `Claim ${formattedDripAmount()} USDC`
                      : `Wait ${formattedCooldown()}`}
                </Button>
              </Show>

              {/* Explanation */}
              <p class="text-xs text-muted-foreground text-center">
                Test tokens for development. Claim once per cooldown period.
              </p>
            </div>
          </Show>
        </CardContent>
      </Card>
    </Show>
  );
}
