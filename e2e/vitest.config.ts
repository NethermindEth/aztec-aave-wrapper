import { defineConfig } from "vitest/config";
import { resolve } from "path";

/**
 * Vitest configuration for E2E tests.
 *
 * Supports multiple test modes:
 * - `bun run test` - All tests (default)
 * - `bun run test:unit` - Unit tests only (helpers, no external dependencies)
 * - `bun run test:mock` - Mock tests (local devnet with mock Wormhole)
 * - `bun run test:integration` - Integration tests (real Wormhole testnet)
 *
 * Environment variables:
 * - TEST_ENVIRONMENT: 'local' | 'testnet'
 * - TEST_MODE: 'mock' | 'integration'
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 120_000, // 2 minutes - cross-chain tests can be slow
    hookTimeout: 60_000, // 1 minute for setup/teardown
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    reporters: ["verbose"],
    // Sequential execution for E2E tests that may have state dependencies
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Setup file for global test configuration
    setupFiles: ["./src/vitest.setup.ts"],
    // Environment variables for test configuration
    env: {
      TEST_ENVIRONMENT: process.env.TEST_ENVIRONMENT || "local",
      TEST_MODE: process.env.TEST_MODE || "mock",
    },
  },
  resolve: {
    alias: {
      "@aztec-aave-wrapper/shared": resolve(__dirname, "../shared/src/index.ts"),
    },
  },
});
