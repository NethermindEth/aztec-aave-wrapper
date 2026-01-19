/**
 * Frontend-specific constants
 */

// =============================================================================
// Protocol Fee Configuration
// =============================================================================

/**
 * Fee configuration for the Aztec Aave Wrapper protocol.
 * Used for calculating and displaying protocol fees on deposits/withdrawals.
 */
export const FEE_CONFIG = {
  /** Fee in basis points (0.1% = 10 basis points) */
  BASIS_POINTS: 10,
  /** Denominator for basis point calculations (10000 = 100%) */
  DENOMINATOR: 10000,
  /** Minimum deposit amount in token units (before decimals) */
  MIN_DEPOSIT: 100,
} as const;

// =============================================================================
// Deadline Constraints
// =============================================================================

/**
 * Deadline constraints - intersection of L1 and L2 requirements:
 * - L1 portal enforces: MIN=5 minutes, MAX=24 hours
 * - L2 contract enforces: MIN=30 minutes, MAX=7 days
 * - Frontend uses intersection: MIN=30 minutes, MAX=24 hours
 */
export const DEADLINE_CONSTRAINTS = {
  /** 30 minutes - L2 constraint (more restrictive than L1's 5 min) */
  MIN_OFFSET_SECONDS: 30 * 60,
  /** 24 hours - L1 constraint (more restrictive than L2's 7 days) */
  MAX_OFFSET_SECONDS: 24 * 60 * 60,
  /** 1 hour default */
  DEFAULT_OFFSET_SECONDS: 60 * 60,
} as const;

// =============================================================================
// Step Labels
// =============================================================================

/**
 * Labels for deposit flow steps
 */
export const DEPOSIT_STEP_LABELS = {
  APPROVE: "Approve USDC",
  REQUEST: "Request Deposit",
  CONFIRM_L2: "Confirm L2 Transaction",
  EXECUTE_L1: "Execute on L1",
  FINALIZE: "Finalize Deposit",
} as const;

/**
 * Labels for withdraw flow steps
 */
export const WITHDRAW_STEP_LABELS = {
  REQUEST: "Request Withdrawal",
  CONFIRM_L2: "Confirm L2 Transaction",
  EXECUTE_L1: "Execute on L1",
  FINALIZE: "Finalize Withdrawal",
} as const;

// =============================================================================
// Timeouts
// =============================================================================

/**
 * Transaction and polling timeouts (in milliseconds)
 */
export const TIMEOUTS = {
  /** Default transaction confirmation timeout */
  TX_CONFIRMATION: 60_000,
  /** L2 to L1 message propagation polling interval */
  MESSAGE_POLL_INTERVAL: 5_000,
  /** Maximum wait for cross-chain message */
  MESSAGE_TIMEOUT: 300_000,
} as const;

// =============================================================================
// UI Constants
// =============================================================================

/**
 * Toast notification durations (in milliseconds)
 */
export const TOAST_DURATIONS = {
  SUCCESS: 5_000,
  ERROR: 8_000,
  INFO: 4_000,
} as const;

/**
 * Debounce delays for user input (in milliseconds)
 */
export const DEBOUNCE_DELAYS = {
  INPUT: 300,
  SEARCH: 500,
} as const;
