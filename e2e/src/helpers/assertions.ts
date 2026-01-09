/**
 * Custom assertion helpers for Aztec Aave Wrapper E2E tests.
 *
 * This module addresses the audit finding in TEST_AUDIT.md lines 239-244
 * which states that tests should enforce single, specific error expectations
 * rather than accepting any error.
 */

import { expect } from "vitest";
import type { Fr } from "@aztec/aztec.js";
import type { PositionReceiptFields } from "./test-utils";

/**
 * Assert that an intent_id matches the expected hash value.
 *
 * This verifies that the intent_id returned from the contract matches
 * the locally computed hash, ensuring integrity of the hashing algorithm.
 *
 * @param actualIntentId - The intent_id returned from the contract
 * @param expectedIntentId - The locally computed expected intent_id
 * @param message - Optional custom error message
 */
export function assertIntentIdValid(
  actualIntentId: Fr | bigint,
  expectedIntentId: Fr | bigint,
  message?: string
): void {
  const actual = typeof actualIntentId === "bigint" ? actualIntentId : actualIntentId.toBigInt();
  const expected = typeof expectedIntentId === "bigint" ? expectedIntentId : expectedIntentId.toBigInt();

  expect(actual, message || "Intent ID should match expected hash").toBe(expected);
}

/**
 * Assert that a note's fields match expected values.
 *
 * Performs deep comparison of PositionReceiptNote fields to ensure
 * all components match expected values.
 *
 * @param actualFields - The parsed note fields from extractNoteFields()
 * @param expectedFields - The expected field values
 */
export function assertNoteFields(
  actualFields: PositionReceiptFields,
  expectedFields: Partial<PositionReceiptFields>
): void {
  if (expectedFields.owner !== undefined) {
    expect(actualFields.owner, "Note owner should match").toBe(expectedFields.owner);
  }
  if (expectedFields.nonce !== undefined) {
    expect(actualFields.nonce, "Note nonce should match").toBe(expectedFields.nonce);
  }
  if (expectedFields.intentId !== undefined) {
    expect(actualFields.intentId, "Note intent_id should match").toBe(expectedFields.intentId);
  }
  if (expectedFields.assetId !== undefined) {
    expect(actualFields.assetId, "Note asset_id should match").toBe(expectedFields.assetId);
  }
  if (expectedFields.shares !== undefined) {
    expect(actualFields.shares, "Note shares should match").toBe(expectedFields.shares);
  }
  if (expectedFields.originalDecimals !== undefined) {
    expect(actualFields.originalDecimals, "Note original_decimals should match").toBe(
      expectedFields.originalDecimals
    );
  }
  if (expectedFields.targetChainId !== undefined) {
    expect(actualFields.targetChainId, "Note target_chain_id should match").toBe(
      expectedFields.targetChainId
    );
  }
  if (expectedFields.status !== undefined) {
    expect(actualFields.status, "Note status should match").toBe(expectedFields.status);
  }
}

/**
 * Assert that a specific error message is thrown.
 *
 * This addresses TEST_AUDIT.md lines 239-244:
 * "The following assertions in contract functions have **no test coverage**"
 *
 * This helper enforces that tests verify the EXACT error message from the contract,
 * not just "any error occurred". This is critical for security testing.
 *
 * Usage:
 * ```typescript
 * await assertSpecificError(
 *   async () => contract.methods.someMethod().send().wait(),
 *   "Intent ID already consumed"
 * );
 * ```
 *
 * @param fn - Async function that should throw
 * @param expectedError - The exact error message expected (can be string or regex)
 * @param context - Optional context message for debugging
 */
export async function assertSpecificError(
  fn: () => Promise<unknown>,
  expectedError: string | RegExp,
  context?: string
): Promise<void> {
  let errorThrown = false;
  let actualError: Error | undefined;

  try {
    await fn();
  } catch (error) {
    errorThrown = true;
    actualError = error as Error;
  }

  // First, verify an error was thrown at all
  expect(errorThrown, `Expected an error to be thrown${context ? ` (${context})` : ""}`).toBe(true);

  // Then verify it matches the expected error
  if (actualError) {
    const errorMessage = actualError.message;
    if (typeof expectedError === "string") {
      expect(
        errorMessage,
        `Expected error "${expectedError}"${context ? ` (${context})` : ""}\nActual error: ${errorMessage}`
      ).toContain(expectedError);
    } else {
      expect(
        errorMessage,
        `Expected error matching ${expectedError}${context ? ` (${context})` : ""}\nActual error: ${errorMessage}`
      ).toMatch(expectedError);
    }
  }
}

/**
 * Assert that an intent_id is non-zero and valid.
 *
 * Intent IDs should never be zero (which would indicate a hash collision or error).
 *
 * @param intentId - The intent_id to validate
 * @param message - Optional custom error message
 */
export function assertIntentIdNonZero(intentId: Fr | bigint, message?: string): void {
  const id = typeof intentId === "bigint" ? intentId : intentId.toBigInt();
  expect(id, message || "Intent ID must be non-zero").not.toBe(0n);
}

/**
 * Assert that a deadline is in the future.
 *
 * @param deadline - The deadline timestamp (in seconds)
 * @param message - Optional custom error message
 */
export function assertDeadlineInFuture(deadline: bigint, message?: string): void {
  const now = BigInt(Math.floor(Date.now() / 1000));
  expect(deadline, message || "Deadline must be in the future").toBeGreaterThan(now);
}

/**
 * Assert that a deadline is in the past (for testing expiration).
 *
 * @param deadline - The deadline timestamp (in seconds)
 * @param message - Optional custom error message
 */
export function assertDeadlineInPast(deadline: bigint, message?: string): void {
  const now = BigInt(Math.floor(Date.now() / 1000));
  expect(deadline, message || "Deadline must be in the past").toBeLessThan(now);
}

/**
 * Known contract error messages from main.nr.
 *
 * These constants ensure consistency across tests and make it easy to update
 * if error messages change in the contract.
 */
export const CONTRACT_ERRORS = {
  // Authorization errors
  POSITION_NOT_FOUND: "Position receipt note not found",
  PENDING_WITHDRAW_NOT_FOUND: "Pending withdraw receipt note not found",
  NOT_THE_OWNER: "Not the owner",

  // Replay protection errors
  INTENT_ALREADY_CONSUMED: "Intent ID already consumed",
  INTENT_NOT_PENDING_DEPOSIT: "Intent not in pending deposit state",
  INTENT_NOT_PENDING_WITHDRAW: "Intent not in pending withdraw state",

  // Balance validation errors
  WITHDRAWAL_EXCEEDS_SHARES: "Withdrawal amount exceeds available shares",
  POSITION_NOT_ACTIVE: "Position is not active",

  // Deadline errors
  DEADLINE_EXPIRED: "Deadline expired",
  DEADLINE_ZERO: "Deadline must be greater than zero",

  // Secret errors
  INVALID_SECRET: "Invalid secret",

  // Status errors
  INVALID_STATUS_TRANSITION: "Invalid status transition",
} as const;

/**
 * Type for contract error keys
 */
export type ContractErrorKey = keyof typeof CONTRACT_ERRORS;

/**
 * Assert a specific contract error using predefined error constants.
 *
 * This is a convenience wrapper around assertSpecificError that uses
 * the CONTRACT_ERRORS constants.
 *
 * Usage:
 * ```typescript
 * await assertContractError(
 *   async () => contract.methods.someMethod().send().wait(),
 *   "INTENT_ALREADY_CONSUMED"
 * );
 * ```
 *
 * @param fn - Async function that should throw
 * @param errorKey - Key from CONTRACT_ERRORS constant
 * @param context - Optional context message for debugging
 */
export async function assertContractError(
  fn: () => Promise<unknown>,
  errorKey: ContractErrorKey,
  context?: string
): Promise<void> {
  const expectedError = CONTRACT_ERRORS[errorKey];
  await assertSpecificError(fn, expectedError, context || errorKey);
}
