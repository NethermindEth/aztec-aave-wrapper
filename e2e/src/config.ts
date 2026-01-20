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

import type { ChainConfig, ContractAddresses } from "@aztec-aave-wrapper/shared";
import { CHAIN_IDS, LOCAL_RPC_URLS } from "@aztec-aave-wrapper/shared";
import * as fs from "fs";
import * as path from "path";

// =============================================================================
// Deployment File Types
// =============================================================================

/**
 * Structure of .deployments.local.json
 */
interface DeploymentsFile {
  l1: {
    mockUsdc: string;
    mockLendingPool: string;
    tokenPortal: string;
    portal: string;
  };
  l2: {
    bridgedToken: string;
    aaveWrapper: string;
  };
  config: {
    l1ChainId: number;
    deployedAt: string;
  };
}

/**
 * Zero addresses for testnet (not yet deployed)
 */
const ZERO_ADDRESSES: ContractAddresses = {
  l1: {
    portal: "0x0000000000000000000000000000000000000000" as `0x${string}`,
    tokenPortal: "0x0000000000000000000000000000000000000000" as `0x${string}`,
    mockUsdc: "0x0000000000000000000000000000000000000000" as `0x${string}`,
    mockLendingPool: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  },
  l2: {
    bridgedToken: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
    aaveWrapper: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
  },
};

/**
 * Load addresses from .deployments.local.json
 */
function loadLocalAddresses(): ContractAddresses {
  const deploymentsPath = path.resolve(__dirname, "../../.deployments.local.json");

  if (!fs.existsSync(deploymentsPath)) {
    console.warn(`Deployments file not found at ${deploymentsPath}. Using zero addresses.`);
    return ZERO_ADDRESSES;
  }

  try {
    const content = fs.readFileSync(deploymentsPath, "utf-8");
    const deployments: DeploymentsFile = JSON.parse(content);

    return {
      l1: {
        portal: deployments.l1.portal as `0x${string}`,
        tokenPortal: deployments.l1.tokenPortal as `0x${string}`,
        mockUsdc: deployments.l1.mockUsdc as `0x${string}`,
        mockLendingPool: deployments.l1.mockLendingPool as `0x${string}`,
      },
      l2: {
        bridgedToken: deployments.l2.bridgedToken as `0x${string}`,
        aaveWrapper: deployments.l2.aaveWrapper as `0x${string}`,
      },
    };
  } catch (error) {
    console.warn(`Failed to load deployments file: ${error}. Using zero addresses.`);
    return ZERO_ADDRESSES;
  }
}

// Load addresses once at module initialization
const localAddresses = loadLocalAddresses();

// =============================================================================
// Environment Types
// =============================================================================

/**
 * Available test environments
 */
export type TestEnvironment = "local" | "testnet";

/**
 * Test mode determines whether to use mock or real L1 execution
 */
export type TestMode = "mock" | "integration";

/**
 * Full test configuration including environment and mode
 */
export interface TestConfig {
  /** Environment (local devnet or testnet) */
  environment: TestEnvironment;
  /** Test mode (mock L1 execution or real integration) */
  mode: TestMode;
  /** Chain configurations */
  chains: {
    l1: ChainConfig;
    l2: ChainConfig;
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
 * Note: Uses simplified L1-only architecture (no target chain)
 */
function createLocalConfig(mode: TestMode): TestConfig {
  return {
    environment: "local",
    mode,
    chains: {
      l1: {
        name: "Anvil L1",
        chainId: CHAIN_IDS.ANVIL_L1,
        rpcUrl: LOCAL_RPC_URLS.L1,
      },
      l2: {
        name: "Aztec Sandbox",
        chainId: 31337, // Aztec uses same as L1 for local
        rpcUrl: LOCAL_RPC_URLS.PXE,
      },
    },
    addresses: localAddresses,
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
 * Note: Uses simplified L1-only architecture (no target chain)
 */
function createTestnetConfig(mode: TestMode): TestConfig {
  return {
    environment: "testnet",
    mode,
    chains: {
      l1: {
        name: "Ethereum Sepolia",
        chainId: CHAIN_IDS.ETHEREUM_SEPOLIA,
        rpcUrl: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
      },
      l2: {
        name: "Aztec Devnet",
        chainId: 0, // TBD when Aztec devnet is available
        rpcUrl: process.env.AZTEC_DEVNET_URL || "http://localhost:8080",
      },
    },
    addresses: ZERO_ADDRESSES, // Testnet addresses not yet deployed
    timeouts: {
      pxeConnection: 60_000,
      deployment: 120_000,
      transaction: 60_000,
      crossChain: 300_000, // 5 min for cross-chain messages
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
  const zeroAztecAddress = "0x0000000000000000000000000000000000000000000000000000000000000000";

  return (
    config.addresses.l2.aaveWrapper !== zeroAztecAddress &&
    config.addresses.l1.portal !== zeroAddress
  );
}

// Re-export commonly used constants for convenience
export {
  CHAIN_IDS,
  LOCAL_RPC_URLS,
} from "@aztec-aave-wrapper/shared";
