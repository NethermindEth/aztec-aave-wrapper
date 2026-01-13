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
  ARBITRUM_ONE: 42161,

  // Testnets
  ETHEREUM_SEPOLIA: 11155111,
  ARBITRUM_SEPOLIA: 421614,

  // Local development
  ANVIL_L1: 31337,
  ANVIL_TARGET: 31338,
} as const;

// =============================================================================
// Wormhole Chain IDs
// These are different from native chain IDs!
// Reference: https://docs.wormhole.com/wormhole/reference/constants
// =============================================================================

export const WORMHOLE_CHAIN_IDS = {
  // Mainnets
  ETHEREUM: 2,
  ARBITRUM: 23,

  // Testnets (same IDs, different networks)
  ETHEREUM_SEPOLIA: 10002,
  ARBITRUM_SEPOLIA: 10003,

  // Local development (custom)
  LOCAL_L1: 2, // Mimics Ethereum
  LOCAL_TARGET: 23, // Mimics Arbitrum
} as const;

// =============================================================================
// Aztec Network Configuration
// =============================================================================

export const AZTEC_CONFIG = {
  // Local sandbox defaults
  LOCAL_PXE_URL: "http://localhost:8081",
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
  [CHAIN_IDS.ARBITRUM_ONE]:
    "0x794a61358D6845594F94dc1DB02A252b5b4814aD" as const,

  // Testnets
  [CHAIN_IDS.ARBITRUM_SEPOLIA]:
    "0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff" as const,
} as const;

/**
 * Wormhole Token Bridge addresses by chain
 */
export const WORMHOLE_TOKEN_BRIDGE_ADDRESSES = {
  // Mainnets
  [CHAIN_IDS.ETHEREUM_MAINNET]:
    "0x3ee18B2214AFF97000D974cf647E7C347E8fa585" as const,
  [CHAIN_IDS.ARBITRUM_ONE]:
    "0x0b2402144Bb366A632D14B83F244D2e0e21bD39c" as const,

  // Testnets
  [CHAIN_IDS.ETHEREUM_SEPOLIA]:
    "0xDB5492265f6038831E89f495670FF909aDe94bd9" as const,
  [CHAIN_IDS.ARBITRUM_SEPOLIA]:
    "0xC7A204bDBFe983FCD8d8E61D02b475D4073fF97e" as const,
} as const;

/**
 * Wormhole Relayer addresses by chain
 */
export const WORMHOLE_RELAYER_ADDRESSES = {
  // Mainnets
  [CHAIN_IDS.ETHEREUM_MAINNET]:
    "0x27428DD2d3DD32A4D7f7C497eAaa23130d894911" as const,
  [CHAIN_IDS.ARBITRUM_ONE]:
    "0x27428DD2d3DD32A4D7f7C497eAaa23130d894911" as const,

  // Testnets
  [CHAIN_IDS.ETHEREUM_SEPOLIA]:
    "0x7B1bD7a6b4E61c2a123AC6BC2cbfC614437D0470" as const,
  [CHAIN_IDS.ARBITRUM_SEPOLIA]:
    "0x7B1bD7a6b4E61c2a123AC6BC2cbfC614437D0470" as const,
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
  [CHAIN_IDS.ARBITRUM_ONE]:
    "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const,

  // Testnets
  [CHAIN_IDS.ETHEREUM_SEPOLIA]:
    "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as const,
  [CHAIN_IDS.ARBITRUM_SEPOLIA]:
    "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as const,
} as const;

// =============================================================================
// Protocol Constants
// =============================================================================

/**
 * Wormhole decimal normalization
 * Wormhole normalizes all token amounts to 8 decimals internally
 */
export const WORMHOLE_DECIMALS = 8;

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
  VAA_REPLAY: "E007",
} as const;

// =============================================================================
// Local Development Defaults
// =============================================================================

export const LOCAL_RPC_URLS = {
  L1: "http://localhost:8545",
  TARGET: "http://localhost:8546",
  PXE: "http://localhost:8081",
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
