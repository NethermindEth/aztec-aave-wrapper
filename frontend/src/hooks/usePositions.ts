/**
 * Positions Hook
 *
 * Custom hook for managing user Aave positions with persistence and withdrawal initiation.
 * Coordinates with the app store for reactive position state and provides helper functions
 * for position lifecycle management.
 *
 * Features:
 * - Reactive access to positions from app state
 * - Persistence to localStorage to survive page refreshes
 * - Duplicate position prevention during retry flows
 * - Position lookup by intent ID for withdrawal initiation
 * - Encrypted secret storage for withdrawal finalization
 */

import { IntentStatus } from "@aztec-aave-wrapper/shared";
import { type Accessor, createEffect, createMemo, on, onMount } from "solid-js";
import {
  clearAllSecrets,
  getSecret,
  hasSecret,
  removeSecret,
  type SecretEntry,
  storeSecret,
} from "../services/secrets.js";
import { addPosition, removePosition, setPositions, updatePosition } from "../store/actions.js";
import { useAppState } from "../store/hooks.js";
import type { PositionDisplay } from "../types/state.js";
import { fromBigIntString } from "../types/state.js";

// =============================================================================
// Constants
// =============================================================================

/** LocalStorage key for position persistence */
const POSITIONS_STORAGE_KEY = "aztec-aave-positions";

/** Flag to track if positions have been loaded from localStorage (prevents duplicate loading across hook instances) */
let hasLoadedFromStorage = false;

// =============================================================================
// Types
// =============================================================================

/**
 * Position for UI rendering with bigint shares (converted from string)
 */
export interface Position {
  /** Unique intent identifier (hex string) */
  intentId: string;
  /** Asset identifier (hex string) */
  assetId: string;
  /** Number of shares as bigint */
  shares: bigint;
  /** Human-readable formatted shares */
  sharesFormatted: string;
  /** Current status of the position */
  status: IntentStatus;
  /** Whether a secret is stored for this position (for withdrawal finalization) */
  hasStoredSecret: boolean;
}

/**
 * Return type of usePositions hook
 */
export interface UsePositionsResult {
  /** Reactive array of positions with bigint shares */
  positions: Accessor<Position[]>;
  /** Get position by intent ID */
  getPosition: (intentId: string) => Position | undefined;
  /** Check if position exists */
  hasPosition: (intentId: string) => boolean;
  /** Add a new position (prevents duplicates) */
  addNewPosition: (position: PositionDisplay) => boolean;
  /** Remove position by intent ID */
  removePositionById: (intentId: string) => void;
  /** Update position status */
  updatePositionStatus: (intentId: string, status: IntentStatus) => void;
  /** Get positions ready for withdrawal (Active status) */
  withdrawablePositions: Accessor<Position[]>;
  /** Total value across all positions */
  totalValue: Accessor<bigint>;
  /** Clear all positions */
  clearAllPositions: () => void;

  // Secret management for withdrawal finalization
  /** Store a secret for a position (call after successful deposit) */
  storePositionSecret: (intentId: string, secretHex: string, l2AddressHex: string) => Promise<void>;
  /** Retrieve a secret for withdrawal finalization */
  getPositionSecret: (intentId: string, l2AddressHex: string) => Promise<SecretEntry | null>;
  /** Check if a secret exists for a position */
  hasPositionSecret: (intentId: string) => boolean;
  /** Remove a secret after successful withdrawal */
  removePositionSecret: (intentId: string) => void;
}

// =============================================================================
// Storage Utilities
// =============================================================================

/**
 * Load positions from localStorage
 * @returns Array of PositionDisplay or empty array if none exist
 */
function loadPositionsFromStorage(): PositionDisplay[] {
  try {
    const stored = localStorage.getItem(POSITIONS_STORAGE_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored) as PositionDisplay[];
    // Validate structure
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (p) =>
        typeof p.intentId === "string" &&
        typeof p.assetId === "string" &&
        typeof p.shares === "string" &&
        typeof p.status === "number"
    );
  } catch {
    return [];
  }
}

/**
 * Save positions to localStorage
 * @param positions - Positions to persist
 */
function savePositionsToStorage(positions: PositionDisplay[]): void {
  try {
    localStorage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify(positions));
  } catch {
    // Storage may be full or unavailable
    console.warn("Failed to persist positions to localStorage");
  }
}

/**
 * Clear positions from localStorage
 */
function clearPositionsFromStorage(): void {
  try {
    localStorage.removeItem(POSITIONS_STORAGE_KEY);
  } catch {
    // Ignore errors
  }
}

// =============================================================================
// Conversion Utilities
// =============================================================================

/**
 * Convert PositionDisplay (with string shares) to Position (with bigint shares)
 */
function toPosition(display: PositionDisplay): Position {
  return {
    intentId: display.intentId,
    assetId: display.assetId,
    shares: fromBigIntString(display.shares),
    sharesFormatted: display.sharesFormatted,
    status: display.status,
    hasStoredSecret: hasSecret(display.intentId),
  };
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook to manage user Aave positions with persistence and withdrawal initiation.
 *
 * Provides reactive access to positions, persistence across page refreshes,
 * and helper functions for position lifecycle management.
 *
 * @returns Position management state and functions
 *
 * @example
 * ```tsx
 * function PositionsPanel() {
 *   const {
 *     positions,
 *     withdrawablePositions,
 *     totalValue,
 *     removePositionById
 *   } = usePositions();
 *
 *   return (
 *     <div>
 *       <p>Total Value: {formatUSDC(totalValue())} USDC</p>
 *       <For each={positions()}>
 *         {(pos) => (
 *           <PositionCard
 *             position={pos}
 *             onWithdraw={() => removePositionById(pos.intentId)}
 *           />
 *         )}
 *       </For>
 *     </div>
 *   );
 * }
 * ```
 */
export function usePositions(): UsePositionsResult {
  const state = useAppState();

  // Convert store positions (string shares) to Position (bigint shares)
  const positions = createMemo<Position[]>(() => state.positions.map(toPosition));

  // Filter positions that are ready for withdrawal
  const withdrawablePositions = createMemo<Position[]>(() =>
    positions().filter((p) => p.status === IntentStatus.Active)
  );

  // Calculate total value across all positions
  const totalValue = createMemo<bigint>(() => positions().reduce((sum, p) => sum + p.shares, 0n));

  // Load positions from localStorage on mount (only once across all hook instances)
  onMount(() => {
    // Prevent duplicate loading when multiple components use this hook
    if (hasLoadedFromStorage) {
      return;
    }
    hasLoadedFromStorage = true;

    const storedPositions = loadPositionsFromStorage();
    if (storedPositions.length > 0) {
      // Merge with any existing positions, avoiding duplicates
      const existingIds = new Set(state.positions.map((p) => p.intentId));
      const newPositions = storedPositions.filter((p) => !existingIds.has(p.intentId));

      if (newPositions.length > 0) {
        setPositions([...state.positions, ...newPositions]);
      }
    }
  });

  // Persist positions to localStorage whenever they change
  createEffect(
    on(
      () => [...state.positions],
      (currentPositions) => {
        savePositionsToStorage(currentPositions);
      },
      { defer: true }
    )
  );

  /**
   * Get position by intent ID
   */
  function getPosition(intentId: string): Position | undefined {
    return positions().find((p) => p.intentId === intentId);
  }

  /**
   * Check if position exists
   */
  function hasPosition(intentId: string): boolean {
    return state.positions.some((p) => p.intentId === intentId);
  }

  /**
   * Add a new position (prevents duplicates)
   * @returns true if position was added, false if duplicate
   */
  function addNewPosition(position: PositionDisplay): boolean {
    // Prevent duplicate positions (important for retry flows)
    if (hasPosition(position.intentId)) {
      return false;
    }
    addPosition(position);
    return true;
  }

  /**
   * Remove position by intent ID.
   * Also removes any associated secret to prevent orphaned data.
   */
  function removePositionById(intentId: string): void {
    removePosition(intentId);
    // Clean up associated secret to prevent orphaned data
    removeSecret(intentId);
  }

  /**
   * Update position status
   */
  function updatePositionStatus(intentId: string, status: IntentStatus): void {
    updatePosition(intentId, { status });
  }

  /**
   * Clear all positions (also clears storage and secrets)
   */
  function clearAllPositions(): void {
    setPositions([]);
    clearPositionsFromStorage();
    clearAllSecrets();
    // Reset loading flag so positions can be reloaded if needed
    hasLoadedFromStorage = false;
  }

  // =========================================================================
  // Secret Management Functions
  // =========================================================================

  /**
   * Store a secret for a position (call after successful deposit).
   * The secret is encrypted using the user's L2 address as the key.
   *
   * @param intentId - The position's intent ID
   * @param secretHex - The secret value as hex string (Fr.toString())
   * @param l2AddressHex - The user's L2 address as hex string
   */
  async function storePositionSecret(
    intentId: string,
    secretHex: string,
    l2AddressHex: string
  ): Promise<void> {
    await storeSecret(intentId, secretHex, l2AddressHex);
  }

  /**
   * Retrieve a secret for withdrawal finalization.
   *
   * @param intentId - The position's intent ID
   * @param l2AddressHex - The user's L2 address as hex string
   * @returns The decrypted secret entry, or null if not found
   */
  async function getPositionSecret(
    intentId: string,
    l2AddressHex: string
  ): Promise<SecretEntry | null> {
    return getSecret(intentId, l2AddressHex);
  }

  /**
   * Check if a secret exists for a position.
   *
   * @param intentId - The position's intent ID
   * @returns True if a secret is stored
   */
  function hasPositionSecret(intentId: string): boolean {
    return hasSecret(intentId);
  }

  /**
   * Remove a secret after successful withdrawal.
   *
   * @param intentId - The position's intent ID
   */
  function removePositionSecret(intentId: string): void {
    removeSecret(intentId);
  }

  return {
    positions,
    getPosition,
    hasPosition,
    addNewPosition,
    removePositionById,
    updatePositionStatus,
    withdrawablePositions,
    totalValue,
    clearAllPositions,
    // Secret management
    storePositionSecret,
    getPositionSecret,
    hasPositionSecret,
    removePositionSecret,
  };
}

// =============================================================================
// Utility Exports
// =============================================================================

/**
 * Check if a position can be withdrawn (Active status)
 */
export function canWithdraw(position: Position): boolean {
  return position.status === IntentStatus.Active;
}

/**
 * Get status label for display
 */
export function getPositionStatusLabel(status: IntentStatus): string {
  switch (status) {
    case IntentStatus.PendingDeposit:
      return "Pending Deposit";
    case IntentStatus.Active:
      return "Active";
    case IntentStatus.PendingWithdraw:
      return "Pending Withdrawal";
    case IntentStatus.Consumed:
      return "Consumed";
    default:
      return "Unknown";
  }
}
