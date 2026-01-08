import { defineConfig } from "vitest/config";
import { resolve } from "path";

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
  },
  resolve: {
    alias: {
      "@aztec-aave-wrapper/shared": resolve(__dirname, "../shared/src/index.ts"),
    },
  },
});
