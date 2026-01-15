/**
 * Shared constants for Aztec Aave Wrapper
 * Chain IDs, well-known addresses, and configuration values
 */

// =============================================================================
// Native Chain IDs (EVM)
// =============================================================================

export const CHAIN_IDS = {
  // Mainnets
  ETHEREUM_MAINNET: 1,

  // Testnets
  ETHEREUM_SEPOLIA: 11155111,

  // Local development
  ANVIL_L1: 31337,
} as const;

// =============================================================================
// Aztec Network Configuration
// =============================================================================

export const AZTEC_CONFIG = {
  // Local sandbox defaults
  LOCAL_PXE_URL: "http://localhost:8080",
  LOCAL_ETHEREUM_RPC: "http://localhost:8545",

  // Testnet (devnet) - placeholder, update when available
  DEVNET_PXE_URL: "https://aztec-devnet.example.com",
} as const;

// =============================================================================
// Well-Known Contract Addresses
// =============================================================================

/**
 * Aave V3 Pool addresses by chain
 */
export const AAVE_POOL_ADDRESSES = {
  // Mainnets
  [CHAIN_IDS.ETHEREUM_MAINNET]:
    "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2" as const,

  // Testnets
  [CHAIN_IDS.ETHEREUM_SEPOLIA]:
    "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951" as const,
} as const;

// =============================================================================
// Token Addresses
// =============================================================================

/**
 * USDC addresses by chain (primary test token)
 */
export const USDC_ADDRESSES = {
  // Mainnets
  [CHAIN_IDS.ETHEREUM_MAINNET]:
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const,

  // Testnets
  [CHAIN_IDS.ETHEREUM_SEPOLIA]:
    "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as const,
} as const;

// =============================================================================
// Protocol Constants
// =============================================================================

/**
 * USDC has 6 decimals
 */
export const USDC_DECIMALS = 6;

/**
 * Default deadline offset (1 hour from now)
 */
export const DEFAULT_DEADLINE_OFFSET = 60 * 60;

/**
 * Maximum deadline offset (24 hours)
 */
export const MAX_DEADLINE_OFFSET = 24 * 60 * 60;

// =============================================================================
// Error Codes
// Reference: PLAN.md Appendix C
// =============================================================================

export const ERROR_CODES = {
  INTENT_CONSUMED: "E001",
  INVALID_SOURCE: "E002",
  DEADLINE_PASSED: "E003",
  INVALID_PROOF: "E004",
  INSUFFICIENT_BALANCE: "E005",
  AAVE_SUPPLY_FAILED: "E006",
} as const;

// =============================================================================
// Local Development Defaults
// =============================================================================

export const LOCAL_RPC_URLS = {
  L1: "http://localhost:8545",
  PXE: "http://localhost:8080",
} as const;

export const LOCAL_PRIVATE_KEYS = {
  // Default Anvil accounts (DO NOT use in production!)
  DEPLOYER:
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const,
  USER1:
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const,
  USER2:
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const,
  // Relayer account - different from user accounts for privacy testing
  RELAYER:
    "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as const,
} as const;
