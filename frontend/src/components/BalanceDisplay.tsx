/**
 * BalanceDisplay Component
 *
 * Reusable balance display with token symbol and formatted amount.
 * Handles edge cases like 0, very small, and very large amounts.
 */

import { Show } from "solid-js";

/**
 * Token symbol configuration with decimals
 */
export interface TokenConfig {
  symbol: string;
  decimals: number;
}

/**
 * Known token configurations
 */
export const KNOWN_TOKENS: Record<string, TokenConfig> = {
  USDC: { symbol: "USDC", decimals: 6 },
  aUSDC: { symbol: "aUSDC", decimals: 6 },
  ETH: { symbol: "ETH", decimals: 18 },
};

/**
 * Props for BalanceDisplay component
 */
export interface BalanceDisplayProps {
  /** Balance as string (raw units, e.g., "1000000" for 1 USDC) */
  balance: string;
  /** Token symbol (e.g., "USDC", "aUSDC") */
  symbol: string;
  /** Optional: override decimals if token not in KNOWN_TOKENS */
  decimals?: number;
  /** Optional: label to display before the balance */
  label?: string;
  /** Optional: CSS class for the container */
  class?: string;
  /** Optional: show full precision (default: smart formatting) */
  fullPrecision?: boolean;
}

/**
 * Format a balance for display with smart precision handling
 *
 * @param balance - Raw balance as string
 * @param decimals - Number of decimal places for the token
 * @param fullPrecision - Whether to show all decimals
 * @returns Formatted balance string
 */
export function formatBalance(balance: string, decimals: number, fullPrecision = false): string {
  // Handle empty or invalid input
  if (!balance || balance === "") {
    return "0";
  }

  try {
    const raw = BigInt(balance);

    // Handle zero
    if (raw === 0n) {
      return "0";
    }

    const divisor = 10n ** BigInt(decimals);
    const wholePart = raw / divisor;
    const fractionalPart = raw % divisor;

    // Handle negative (shouldn't happen but be safe)
    const isNegative = raw < 0n;
    const absWhole = isNegative ? -wholePart : wholePart;
    const absFractional = isNegative ? -fractionalPart : fractionalPart;

    // Build the fractional string with leading zeros
    let fractionalStr = absFractional.toString().padStart(decimals, "0");

    if (fullPrecision) {
      // Show all decimals, trimming trailing zeros
      fractionalStr = fractionalStr.replace(/0+$/, "");
    } else {
      // Smart formatting: show meaningful precision
      // For very small amounts (less than 0.01), show more precision
      // For normal amounts, show 2-6 decimals based on significance

      if (absWhole === 0n && absFractional > 0n) {
        // Very small amount (less than 1 whole unit)
        // Find first significant digit
        const firstSignificant = fractionalStr.search(/[1-9]/);
        if (firstSignificant >= 0) {
          // Show at least 2 significant digits
          const endIdx = Math.min(firstSignificant + 2, decimals);
          fractionalStr = fractionalStr.slice(0, endIdx);
        }
      } else {
        // Normal amount - show up to 6 decimals, trim trailing zeros
        fractionalStr = fractionalStr.slice(0, 6).replace(/0+$/, "");
      }
    }

    // Format whole part with thousand separators for large amounts
    const wholeStr = formatWithSeparators(absWhole);

    // Combine parts
    const sign = isNegative ? "-" : "";
    if (fractionalStr === "") {
      return `${sign}${wholeStr}`;
    }
    return `${sign}${wholeStr}.${fractionalStr}`;
  } catch {
    // If BigInt parsing fails, return the raw value
    return balance;
  }
}

/**
 * Format a bigint with thousand separators for readability
 */
function formatWithSeparators(value: bigint): string {
  const str = value.toString();
  // Add thousand separators for values >= 1,000,000
  if (str.length > 6) {
    return str.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  return str;
}

/**
 * Get token configuration, falling back to provided decimals or default
 */
function getTokenConfig(symbol: string, overrideDecimals?: number): TokenConfig {
  const known = KNOWN_TOKENS[symbol];
  if (known) {
    return known;
  }
  // Unknown token - use override or default to 18 decimals
  return {
    symbol,
    decimals: overrideDecimals ?? 18,
  };
}

/**
 * BalanceDisplay renders a formatted token balance with symbol.
 *
 * Features:
 * - Smart decimal formatting (handles 0, very small, very large amounts)
 * - Thousand separators for large amounts
 * - Configurable token decimals
 * - Optional label prefix
 *
 * @example
 * ```tsx
 * // Simple usage
 * <BalanceDisplay balance="1000000" symbol="USDC" />
 * // Output: "1 USDC"
 *
 * // With label
 * <BalanceDisplay balance="1000000" symbol="USDC" label="Available" />
 * // Output: "Available: 1 USDC"
 *
 * // Very small amount
 * <BalanceDisplay balance="100" symbol="USDC" />
 * // Output: "0.0001 USDC"
 *
 * // Large amount
 * <BalanceDisplay balance="1234567890123" symbol="USDC" />
 * // Output: "1,234,567.890123 USDC"
 * ```
 */
export function BalanceDisplay(props: BalanceDisplayProps) {
  const config = () => getTokenConfig(props.symbol, props.decimals);

  const formattedBalance = () =>
    formatBalance(props.balance, config().decimals, props.fullPrecision);

  return (
    <span class={props.class}>
      <Show when={props.label}>
        <span class="text-muted-foreground">{props.label}: </span>
      </Show>
      <span class="font-mono">
        {formattedBalance()} {props.symbol}
      </span>
    </span>
  );
}
