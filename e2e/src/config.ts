/**
 * Environment configuration for E2E tests.
 *
 * Provides configuration for:
 * - Local devnet (Docker Compose environment)
 * - Testnet (simplified L1-only mode)
 *
 * Usage:
 *   import { getConfig, TestEnvironment } from './config';
 *   const config = getConfig('local');
 */

import type {
  ContractAddresses,
  ChainConfig,
} from "@aztec-aave-wrapper/shared";
import {
  CHAIN_IDS,
  WORMHOLE_CHAIN_IDS,
  LOCAL_RPC_URLS,
} from "@aztec-aave-wrapper/shared";

// Import deployed addresses (populated by deployment scripts)
import addresses from "./config/addresses.json" with { type: "json" };

// =============================================================================
// Environment Types
// =============================================================================

/**
 * Available test environments
 */
export type TestEnvironment = "local" | "testnet";

/**
 * Test mode determines whether to use mock or real Wormhole
 */
export type TestMode = "mock" | "integration";

/**
 * Full test configuration including environment and mode
 */
export interface TestConfig {
  /** Environment (local devnet or testnet) */
  environment: TestEnvironment;
  /** Test mode (mock Wormhole or real integration) */
  mode: TestMode;
  /** Chain configurations */
  chains: {
    l1: ChainConfig;
    l2: ChainConfig;
    /** Target chain (optional, for cross-chain tests) */
    target?: ChainConfig;
  };
  /** Contract addresses */
  addresses: ContractAddresses;
  /** Timeouts for various operations */
  timeouts: {
    /** PXE connection timeout */
    pxeConnection: number;
    /** Contract deployment timeout */
    deployment: number;
    /** Transaction confirmation timeout */
    transaction: number;
    /** Cross-chain message timeout */
    crossChain: number;
  };
  /** Test amounts (in wei/smallest unit) */
  amounts: {
    /** Default deposit amount (1 USDC with 6 decimals) */
    defaultDeposit: bigint;
    /** Small deposit for edge cases */
    smallDeposit: bigint;
    /** Large deposit for stress testing */
    largeDeposit: bigint;
  };
}

// =============================================================================
// Configuration Factories
// =============================================================================

/**
 * Create configuration for local devnet environment
 * Note: Uses simplified L1-only architecture (no target chain / Wormhole bridging)
 */
function createLocalConfig(mode: TestMode): TestConfig {
  return {
    environment: "local",
    mode,
    chains: {
      l1: {
        name: "Anvil L1",
        chainId: CHAIN_IDS.ANVIL_L1,
        wormholeChainId: WORMHOLE_CHAIN_IDS.LOCAL_L1,
        rpcUrl: LOCAL_RPC_URLS.L1,
      },
      l2: {
        name: "Aztec Sandbox",
        chainId: 31337, // Aztec uses same as L1 for local
        wormholeChainId: 0, // No Wormhole on L2
        rpcUrl: LOCAL_RPC_URLS.PXE,
      },
      // Target chain is not used in simplified L1-only architecture
    },
    addresses: addresses.local as ContractAddresses,
    timeouts: {
      pxeConnection: 30_000,
      deployment: 60_000,
      transaction: 30_000,
      crossChain: 120_000,
    },
    amounts: {
      defaultDeposit: 1_000_000n, // 1 USDC (6 decimals)
      smallDeposit: 100n, // 0.0001 USDC
      largeDeposit: 1_000_000_000n, // 1000 USDC
    },
  };
}

/**
 * Create configuration for testnet environment
 * Note: Uses simplified L1-only architecture (no target chain / Wormhole bridging)
 */
function createTestnetConfig(mode: TestMode): TestConfig {
  return {
    environment: "testnet",
    mode,
    chains: {
      l1: {
        name: "Ethereum Sepolia",
        chainId: CHAIN_IDS.ETHEREUM_SEPOLIA,
        wormholeChainId: WORMHOLE_CHAIN_IDS.ETHEREUM_SEPOLIA,
        rpcUrl: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
      },
      l2: {
        name: "Aztec Devnet",
        chainId: 0, // TBD when Aztec devnet is available
        wormholeChainId: 0,
        rpcUrl: process.env.AZTEC_DEVNET_URL || "http://localhost:8080",
      },
      // Target chain is not used in simplified L1-only architecture
    },
    addresses: addresses.testnet as ContractAddresses,
    timeouts: {
      pxeConnection: 60_000,
      deployment: 120_000,
      transaction: 60_000,
      crossChain: 300_000, // 5 min for real Wormhole
    },
    amounts: {
      defaultDeposit: 1_000_000n,
      smallDeposit: 100n,
      largeDeposit: 10_000_000n, // 10 USDC for testnet
    },
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get test configuration for the specified environment and mode.
 *
 * @param environment - Target environment (local or testnet)
 * @param mode - Test mode (mock or integration), defaults to 'mock'
 * @returns Complete test configuration
 *
 * @example
 * ```ts
 * // Local mock tests
 * const config = getConfig('local', 'mock');
 *
 * // Testnet integration tests
 * const config = getConfig('testnet', 'integration');
 * ```
 */
export function getConfig(
  environment: TestEnvironment = "local",
  mode: TestMode = "mock"
): TestConfig {
  if (environment === "local") {
    return createLocalConfig(mode);
  }
  return createTestnetConfig(mode);
}

/**
 * Get configuration from environment variables.
 * Falls back to local/mock if not specified.
 *
 * Environment variables:
 * - TEST_ENVIRONMENT: 'local' | 'testnet'
 * - TEST_MODE: 'mock' | 'integration'
 *
 * @returns Test configuration based on environment variables
 */
export function getConfigFromEnv(): TestConfig {
  const environment = (process.env.TEST_ENVIRONMENT as TestEnvironment) || "local";
  const mode = (process.env.TEST_MODE as TestMode) || "mock";
  return getConfig(environment, mode);
}

/**
 * Check if addresses are populated (not zero addresses).
 * Used to determine if deployment is needed.
 *
 * @param config - Test configuration to check
 * @returns true if addresses appear to be deployed
 */
export function areAddressesDeployed(config: TestConfig): boolean {
  const zeroAddress = "0x0000000000000000000000000000000000000000";
  const zeroAztecAddress =
    "0x0000000000000000000000000000000000000000000000000000000000000000";

  return (
    config.addresses.l2.aaveWrapper !== zeroAztecAddress &&
    config.addresses.l1.portal !== zeroAddress
  );
}

// Re-export commonly used constants for convenience
export {
  CHAIN_IDS,
  WORMHOLE_CHAIN_IDS,
  LOCAL_RPC_URLS,
} from "@aztec-aave-wrapper/shared";
