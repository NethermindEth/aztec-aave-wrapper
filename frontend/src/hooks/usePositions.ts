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
 */

import { IntentStatus } from "@aztec-aave-wrapper/shared";
import { type Accessor, createEffect, createMemo, on, onMount } from "solid-js";
import {
  addPosition,
  removePosition,
  setPositions,
  updatePosition,
} from "../store/actions.js";
import { useAppState } from "../store/hooks.js";
import type { PositionDisplay } from "../types/state.js";
import { fromBigIntString } from "../types/state.js";

// =============================================================================
// Constants
// =============================================================================

/** LocalStorage key for position persistence */
const POSITIONS_STORAGE_KEY = "aztec-aave-positions";

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
  const positions = createMemo<Position[]>(() =>
    state.positions.map(toPosition)
  );

  // Filter positions that are ready for withdrawal
  const withdrawablePositions = createMemo<Position[]>(() =>
    positions().filter((p) => p.status === IntentStatus.Active)
  );

  // Calculate total value across all positions
  const totalValue = createMemo<bigint>(() =>
    positions().reduce((sum, p) => sum + p.shares, 0n)
  );

  // Load positions from localStorage on mount
  onMount(() => {
    const storedPositions = loadPositionsFromStorage();
    if (storedPositions.length > 0) {
      // Merge with any existing positions, avoiding duplicates
      const existingIds = new Set(state.positions.map((p) => p.intentId));
      const newPositions = storedPositions.filter(
        (p) => !existingIds.has(p.intentId)
      );

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
   * Remove position by intent ID
   */
  function removePositionById(intentId: string): void {
    removePosition(intentId);
  }

  /**
   * Update position status
   */
  function updatePositionStatus(intentId: string, status: IntentStatus): void {
    updatePosition(intentId, { status });
  }

  /**
   * Clear all positions (also clears storage)
   */
  function clearAllPositions(): void {
    setPositions([]);
    clearPositionsFromStorage();
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
    default:
      return "Unknown";
  }
}
