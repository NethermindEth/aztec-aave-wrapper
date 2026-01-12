/**
 * Vitest Global Setup
 *
 * This file runs before all tests and sets up the global test environment.
 * It handles:
 * - Environment detection (local vs testnet)
 * - Test mode detection (mock vs integration)
 * - Global test utilities
 */

import { beforeAll, afterAll, expect } from "vitest";
import { getConfigFromEnv, type TestConfig } from "./config";

// =============================================================================
// Global Test State
// =============================================================================

/**
 * Global test configuration - accessible in all tests
 */
export let globalTestConfig: TestConfig;

/**
 * Whether the test environment is ready
 */
export let isTestEnvironmentReady = false;

// =============================================================================
// Setup Hooks
// =============================================================================

beforeAll(async () => {
  // Load configuration from environment
  globalTestConfig = getConfigFromEnv();

  console.log("\n========================================");
  console.log("E2E Test Environment Setup");
  console.log("========================================");
  console.log(`Environment: ${globalTestConfig.environment}`);
  console.log(`Mode: ${globalTestConfig.mode}`);
  console.log(`L1 RPC: ${globalTestConfig.chains.l1.rpcUrl}`);
  console.log(`L2 PXE: ${globalTestConfig.chains.l2.rpcUrl}`);
  console.log(`Target RPC: ${globalTestConfig.chains.target.rpcUrl}`);
  console.log("========================================\n");

  isTestEnvironmentReady = true;
});

afterAll(async () => {
  console.log("\n========================================");
  console.log("E2E Test Environment Teardown");
  console.log("========================================\n");

  isTestEnvironmentReady = false;
});

// =============================================================================
// Custom Matchers
// =============================================================================

// Extend Vitest expect with custom matchers
expect.extend({
  /**
   * Check if a value is a valid Aztec Field element (non-negative bigint < p)
   */
  toBeValidField(received: unknown) {
    const FIELD_MODULUS =
      21888242871839275222246405745257275088548364400416034343698204186575808495617n;

    if (typeof received !== "bigint") {
      return {
        message: () => `Expected ${received} to be a bigint`,
        pass: false,
      };
    }

    if (received < 0n) {
      return {
        message: () => `Expected ${received} to be non-negative`,
        pass: false,
      };
    }

    if (received >= FIELD_MODULUS) {
      return {
        message: () => `Expected ${received} to be less than field modulus`,
        pass: false,
      };
    }

    return {
      message: () => `Expected ${received} not to be a valid field element`,
      pass: true,
    };
  },

  /**
   * Check if a hex string is a valid 32-byte hash
   */
  toBeValidHash(received: unknown) {
    if (typeof received !== "string") {
      return {
        message: () => `Expected ${received} to be a string`,
        pass: false,
      };
    }

    // Check for 0x prefix and 64 hex chars (32 bytes)
    const hashRegex = /^0x[0-9a-fA-F]{64}$/;

    if (!hashRegex.test(received)) {
      return {
        message: () =>
          `Expected ${received} to be a valid 32-byte hash (0x followed by 64 hex chars)`,
        pass: false,
      };
    }

    return {
      message: () => `Expected ${received} not to be a valid hash`,
      pass: true,
    };
  },

  /**
   * Check if a value is a valid Ethereum address
   */
  toBeValidAddress(received: unknown) {
    if (typeof received !== "string") {
      return {
        message: () => `Expected ${received} to be a string`,
        pass: false,
      };
    }

    // Check for 0x prefix and 40 hex chars (20 bytes)
    const addressRegex = /^0x[0-9a-fA-F]{40}$/;

    if (!addressRegex.test(received)) {
      return {
        message: () =>
          `Expected ${received} to be a valid address (0x followed by 40 hex chars)`,
        pass: false,
      };
    }

    return {
      message: () => `Expected ${received} not to be a valid address`,
      pass: true,
    };
  },

  /**
   * Check if a deadline is in the future
   */
  toBeInFuture(received: unknown) {
    const now = BigInt(Math.floor(Date.now() / 1000));

    if (typeof received === "number") {
      const value = BigInt(received);
      return {
        message: () =>
          value > now
            ? `Expected ${received} not to be in the future`
            : `Expected ${received} to be in the future (current time: ${now})`,
        pass: value > now,
      };
    }

    if (typeof received === "bigint") {
      return {
        message: () =>
          received > now
            ? `Expected ${received} not to be in the future`
            : `Expected ${received} to be in the future (current time: ${now})`,
        pass: received > now,
      };
    }

    return {
      message: () => `Expected ${received} to be a number or bigint`,
      pass: false,
    };
  },
});

// =============================================================================
// Type Declarations for Custom Matchers
// =============================================================================

// Note: We're using interface merging to extend vitest's Assertion interface
// The T = unknown parameter must match vitest's original declaration
interface CustomMatchers {
  toBeValidField(): void;
  toBeValidHash(): void;
  toBeValidAddress(): void;
  toBeInFuture(): void;
}

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Assertion<T = any> extends CustomMatchers {}
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}
