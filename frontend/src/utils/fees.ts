/**
 * Fee calculation utilities for the Aztec Aave Wrapper protocol.
 *
 * All calculations use bigint arithmetic to avoid precision loss and rounding errors.
 */

import { FEE_CONFIG } from "../config/constants.js";

/**
 * Calculate the protocol fee for a given amount.
 *
 * Fee = amount * BASIS_POINTS / DENOMINATOR
 *
 * @param amount - The gross amount (in smallest token units, e.g., wei or USDC base units)
 * @returns The fee amount as bigint
 */
export function calculateFee(amount: bigint): bigint {
  if (amount < 0n) {
    throw new Error("Amount cannot be negative");
  }
  return (amount * BigInt(FEE_CONFIG.BASIS_POINTS)) / BigInt(FEE_CONFIG.DENOMINATOR);
}

/**
 * Calculate the net amount after deducting the protocol fee.
 *
 * Net = amount - fee
 *
 * @param amount - The gross amount (in smallest token units)
 * @returns The net amount after fee deduction as bigint
 */
export function calculateNetAmount(amount: bigint): bigint {
  if (amount < 0n) {
    throw new Error("Amount cannot be negative");
  }
  const fee = calculateFee(amount);
  return amount - fee;
}

/**
 * Validate that an amount meets the minimum deposit requirement.
 *
 * @param amount - The deposit amount (in smallest token units)
 * @param decimals - The token's decimal places (default: 6 for USDC)
 * @returns Object with isValid flag and optional error message
 */
export function validateMinDeposit(
  amount: bigint,
  decimals: number = 6
): { isValid: boolean; error?: string } {
  if (amount < 0n) {
    return { isValid: false, error: "Amount cannot be negative" };
  }

  // MIN_DEPOSIT is in token units (e.g., 100 USDC), convert to base units
  const minAmountBaseUnits = BigInt(FEE_CONFIG.MIN_DEPOSIT) * 10n ** BigInt(decimals);

  if (amount < minAmountBaseUnits) {
    return {
      isValid: false,
      error: `Minimum deposit is ${FEE_CONFIG.MIN_DEPOSIT} tokens`,
    };
  }

  return { isValid: true };
}

/**
 * Calculate the gross amount needed to receive a specific net amount after fees.
 *
 * Useful when user wants to deposit exactly X amount after fees.
 * Gross = Net * DENOMINATOR / (DENOMINATOR - BASIS_POINTS)
 *
 * @param netAmount - The desired net amount after fees
 * @returns The gross amount needed before fees
 */
export function calculateGrossFromNet(netAmount: bigint): bigint {
  if (netAmount < 0n) {
    throw new Error("Amount cannot be negative");
  }
  const denominator = BigInt(FEE_CONFIG.DENOMINATOR);
  const basisPoints = BigInt(FEE_CONFIG.BASIS_POINTS);

  // Round up to ensure net amount is achieved
  return (netAmount * denominator + denominator - basisPoints - 1n) / (denominator - basisPoints);
}

/**
 * Get the fee percentage as a human-readable string.
 *
 * @returns Fee percentage string (e.g., "0.1%")
 */
export function getFeePercentage(): string {
  const percentage = (FEE_CONFIG.BASIS_POINTS / FEE_CONFIG.DENOMINATOR) * 100;
  return `${percentage}%`;
}

/**
 * Format a token amount from base units to human-readable string.
 *
 * @param amount - Amount in base units (e.g., 1000000 for 1 USDC)
 * @param decimals - Token decimals (default: 6 for USDC)
 * @param maxDisplayDecimals - Maximum decimals to display (default: 2)
 * @returns Formatted string (e.g., "1.00")
 */
export function formatTokenAmount(
  amount: bigint,
  decimals: number = 6,
  maxDisplayDecimals: number = 2
): string {
  const divisor = 10n ** BigInt(decimals);
  const wholePart = amount / divisor;
  const fractionalPart = amount % divisor;

  if (fractionalPart === 0n || maxDisplayDecimals === 0) {
    return wholePart.toString();
  }

  // Pad fractional part with leading zeros
  const fractionalStr = fractionalPart.toString().padStart(decimals, "0");
  // Trim to max display decimals
  const displayFractional = fractionalStr.slice(0, maxDisplayDecimals);
  // Remove trailing zeros
  const trimmed = displayFractional.replace(/0+$/, "");

  if (trimmed === "") {
    return wholePart.toString();
  }

  return `${wholePart}.${trimmed}`;
}

/**
 * Parse a human-readable token amount to base units.
 *
 * @param amount - Human-readable amount string (e.g., "1.5")
 * @param decimals - Token decimals (default: 6 for USDC)
 * @returns Amount in base units as bigint
 * @throws Error if amount string is invalid
 */
export function parseTokenAmount(amount: string, decimals: number = 6): bigint {
  const trimmed = amount.trim();

  if (trimmed === "" || trimmed === ".") {
    return 0n;
  }

  // Validate format
  if (!/^-?\d*\.?\d*$/.test(trimmed)) {
    throw new Error("Invalid amount format");
  }

  const isNegative = trimmed.startsWith("-");
  const absAmount = isNegative ? trimmed.slice(1) : trimmed;

  const parts = absAmount.split(".");
  const wholePart = parts[0] || "0";
  let fractionalPart = parts[1] || "";

  // Truncate or pad fractional part to match decimals
  if (fractionalPart.length > decimals) {
    fractionalPart = fractionalPart.slice(0, decimals);
  } else {
    fractionalPart = fractionalPart.padEnd(decimals, "0");
  }

  const baseUnits = BigInt(wholePart) * 10n ** BigInt(decimals) + BigInt(fractionalPart);

  return isNegative ? -baseUnits : baseUnits;
}
