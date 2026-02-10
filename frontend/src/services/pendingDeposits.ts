/**
 * Pending Deposits Service
 *
 * Plain JSON localStorage service for storing pending deposit metadata
 * between Phase 1 (L2 request_deposit) and Phase 2 (L1 executeDeposit).
 *
 * No encryption needed — all data is publicly derivable from on-chain state.
 * Follows the same localStorage pattern as secrets.ts (lines 181-212).
 * BigInt values stored as strings (matches PositionDisplay pattern in types/state.ts).
 */

// =============================================================================
// Constants
// =============================================================================

/** LocalStorage key for pending deposits (distinct from pendingBridges) */
const STORAGE_KEY = "aztec-aave-pending-deposits";

// =============================================================================
// Types
// =============================================================================

/**
 * A pending deposit awaiting Phase 2 (L1 execution).
 *
 * All bigint/Fr values are stored as strings for JSON serialization.
 * Fields capture everything needed to reconstruct the L2→L1 message hash
 * and execute the deposit on L1.
 */
export interface PendingDeposit {
  /** Unique intent identifier from request_deposit (hex string) */
  intentId: string;
  /** Owner hash: poseidon2_hash([caller, intent_id]) (hex string) */
  ownerHash: string;
  /** L1 token address (hex string) */
  asset: string;
  /** Original deposit amount before fee (decimal string) */
  amount: string;
  /** Net amount after fee deduction (decimal string) */
  netAmount: string;
  /** Token decimals (number) */
  originalDecimals: number;
  /** L1 deadline timestamp in seconds (decimal string) */
  deadline: string;
  /** poseidon2_hash([caller, secret_hash]) (hex string) */
  salt: string;
  /** Secret hash from generated secret pair (hex string) */
  secretHash: string;
  /** L2 block number containing the request_deposit tx (decimal string) */
  l2BlockNumber: string;
  /** L2 contract address for message hash computation (hex string) */
  l2ContractAddress: string;
  /** L2 request_deposit transaction hash */
  l2TxHash: string;
  /** Timestamp when this pending deposit was created (ms since epoch) */
  createdAt: number;
}

// =============================================================================
// Storage Operations
// =============================================================================

/**
 * Load pending deposits from localStorage.
 *
 * @returns Array of pending deposits, empty array on parse failure
 */
function loadPendingDeposits(): PendingDeposit[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored) as PendingDeposit[];
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (d) =>
        typeof d.intentId === "string" &&
        typeof d.ownerHash === "string" &&
        typeof d.asset === "string" &&
        typeof d.amount === "string" &&
        typeof d.netAmount === "string" &&
        typeof d.originalDecimals === "number" &&
        typeof d.deadline === "string" &&
        typeof d.salt === "string" &&
        typeof d.secretHash === "string" &&
        typeof d.l2BlockNumber === "string" &&
        typeof d.l2ContractAddress === "string" &&
        typeof d.createdAt === "number"
    );
  } catch {
    return [];
  }
}

/**
 * Save pending deposits to localStorage.
 *
 * @param deposits - Array of pending deposits to persist
 */
function storePendingDeposits(deposits: PendingDeposit[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(deposits));
  } catch {
    console.warn("Failed to persist pending deposits to localStorage");
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Save a pending deposit after Phase 1 completes.
 *
 * If a deposit with the same intentId already exists, it is replaced.
 *
 * @param deposit - The pending deposit to save
 */
export function savePendingDeposit(deposit: PendingDeposit): void {
  const deposits = loadPendingDeposits();
  const normalizedId = deposit.intentId.toLowerCase();
  const filtered = deposits.filter((d) => d.intentId.toLowerCase() !== normalizedId);
  filtered.push(deposit);
  storePendingDeposits(filtered);
}

/**
 * Get all pending deposits.
 *
 * @returns Array of all pending deposits
 */
export function getPendingDeposits(): PendingDeposit[] {
  return loadPendingDeposits();
}

/**
 * Get a single pending deposit by intent ID.
 *
 * @param intentId - The intent ID to look up
 * @returns The pending deposit, or null if not found
 */
export function getPendingDeposit(intentId: string): PendingDeposit | null {
  const deposits = loadPendingDeposits();
  const normalizedId = intentId.toLowerCase();
  return deposits.find((d) => d.intentId.toLowerCase() === normalizedId) ?? null;
}

/**
 * Remove a pending deposit after Phase 2 completes (or on cancellation).
 *
 * @param intentId - The intent ID to remove
 */
export function removePendingDeposit(intentId: string): void {
  const deposits = loadPendingDeposits();
  const normalizedId = intentId.toLowerCase();
  const filtered = deposits.filter((d) => d.intentId.toLowerCase() !== normalizedId);
  storePendingDeposits(filtered);
}
