/**
 * USDC formatting utilities
 *
 * Provides compact display formatting for USDC amounts.
 * Uses bigint arithmetic to avoid floating-point precision loss.
 */

/**
 * Format bigint amount to compact display string (6 decimals for USDC)
 * Shows 2 decimal places for compact UI display.
 *
 * @param amount - Amount in USDC base units (6 decimals)
 * @returns Formatted string like "123.45"
 *
 * @example
 * formatAmount(1_000_000n) // "1.00"
 * formatAmount(1_234_567n) // "1.23"
 */
export const formatAmount = (amount: bigint): string => {
  const wholePart = amount / 1_000_000n;
  const decimalPart = amount % 1_000_000n;
  const decimalStr = decimalPart.toString().padStart(6, "0").slice(0, 2);
  return `${wholePart}.${decimalStr}`;
};
