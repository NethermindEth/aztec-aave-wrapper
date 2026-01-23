/**
 * Positions Hook
 *
 * Custom hook for managing user Aave positions with L2 as the ONLY source of truth.
 * NO localStorage caching - positions come exclusively from on-chain L2 queries.
 *
 * Features:
 * - Reactive access to positions from app state
 * - L2 contract queries as the ONLY source of position data
 * - Duplicate position prevention during retry flows
 * - Position lookup by intent ID for withdrawal initiation
 * - Encrypted secret storage for withdrawal finalization (secrets still use localStorage)
 *
 * Data Flow:
 * 1. On mount: Empty positions (no cache)
 * 2. User clicks "Refresh from L2": Queries private notes from L2 contract
 * 3. After deposit/withdraw: Position added/removed in memory, refresh from L2 to sync
 */

import { IntentStatus } from "@aztec-aave-wrapper/shared";
import { type Accessor, createMemo, createSignal } from "solid-js";
import { type Address, type Chain, type Hex, type PublicClient, pad, type Transport } from "viem";
import { getWithdrawalBridgeMessageKey } from "../services/l1/portal.js";
import type { AaveWrapperContract } from "../services/l2/contract.js";
import { L2PositionStatus, queryL2Positions } from "../services/l2/positions.js";
import {
  clearAllSecrets,
  getSecret,
  hasSecret,
  removeSecret,
  type SecretEntry,
  storeSecret,
} from "../services/secrets.js";
import type { AnyAztecWallet } from "../services/wallet/index.js";
import { addPosition, removePosition, setPositions, updatePosition } from "../store/actions.js";
import { useAppState } from "../store/hooks.js";
import type { PositionDisplay } from "../types/state.js";
import { formatUSDC, fromBigIntString, toBigIntString } from "../types/state.js";

// =============================================================================
// Constants
// =============================================================================

// No localStorage - positions come only from L2 on-chain data

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
  /** Deadline timestamp for pending deposits (unix seconds, 0 if not pending) */
  deadline: bigint;
  /** Net amount for pending deposit refunds (0 if not pending) */
  netAmount: bigint;
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

  // L2 refresh
  /** Refresh positions from L2 contract (source of truth) */
  refreshFromL2: (
    contract: AaveWrapperContract,
    wallet: AnyAztecWallet,
    ownerAddress: string
  ) => Promise<void>;
  /** Whether L2 refresh is in progress */
  isRefreshing: Accessor<boolean>;
  /** Error from last L2 refresh attempt */
  refreshError: Accessor<string | null>;

  // Post-refresh filtering
  /** Filter out positions where withdrawal was already consumed on L1 */
  filterClaimedWithdrawals: (
    publicClient: PublicClient<Transport, Chain>,
    portalAddress: Address,
    l2WalletAddress: string
  ) => Promise<void>;

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
// Storage Utilities (secrets only, no position caching)
// =============================================================================

/**
 * Get all stored secret keys (intent IDs) from localStorage.
 * Secrets are still stored locally as they're needed for withdrawal finalization.
 */
function getAllStoredSecretKeys(): string[] {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("aztec-aave-secret-")) {
        // Extract intent ID from key
        keys.push(key.replace("aztec-aave-secret-", ""));
      }
    }
    return keys;
  } catch {
    return [];
  }
}

// =============================================================================
// Status Mapping
// =============================================================================

/**
 * Map L2 position status to IntentStatus enum.
 *
 * L2 PositionReceiptNote status values (from main.nr):
 * - 1: PendingDeposit - Deposit initiated, awaiting L1 confirmation
 * - 2: Active (CONFIRMED) - Position is active on L1 Aave pool
 * - 3: Cancelled - Deposit was cancelled
 * - 4: PendingWithdraw - Withdrawal initiated, awaiting completion
 * - 5: Withdrawn - Withdrawal completed
 */
function mapL2StatusToIntentStatus(l2Status: number): IntentStatus {
  switch (l2Status) {
    case L2PositionStatus.PendingDeposit:
      return IntentStatus.PendingDeposit;
    case L2PositionStatus.Active:
      return IntentStatus.Confirmed;
    case L2PositionStatus.PendingWithdraw:
      return IntentStatus.PendingWithdraw;
    default:
      // Unknown status, default to PendingDeposit
      return IntentStatus.PendingDeposit;
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
    deadline: display.deadline ? fromBigIntString(display.deadline) : 0n,
    netAmount: display.netAmount ? fromBigIntString(display.netAmount) : 0n,
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

  // L2 refresh state
  const [isRefreshing, setIsRefreshing] = createSignal(false);
  const [refreshError, setRefreshError] = createSignal<string | null>(null);

  // Convert store positions (string shares) to Position (bigint shares)
  const positions = createMemo<Position[]>(() => state.positions.map(toPosition));

  // Filter positions that are ready for withdrawal
  const withdrawablePositions = createMemo<Position[]>(() =>
    positions().filter((p) => p.status === IntentStatus.Confirmed)
  );

  // Calculate total value across all positions
  const totalValue = createMemo<bigint>(() => positions().reduce((sum, p) => sum + p.shares, 0n));

  // No localStorage loading - positions come only from L2 on-chain calls

  /**
   * Refresh positions from L2 contract.
   *
   * This queries the user's private notes from the L2 contract via the PXE.
   * L2 is the source of truth - positions not found on L2 are removed from local state.
   *
   * @param contract - AaveWrapper contract instance
   * @param wallet - Connected Azguard wallet
   * @param ownerAddress - L2 address of the position owner
   */
  async function refreshFromL2(
    contract: AaveWrapperContract,
    wallet: AnyAztecWallet,
    ownerAddress: string
  ): Promise<void> {
    console.log("[refreshFromL2] Starting refresh for owner:", ownerAddress);
    setIsRefreshing(true);
    setRefreshError(null);

    try {
      console.log("[refreshFromL2] Calling queryL2Positions...");
      const result = await queryL2Positions(contract, wallet, ownerAddress);
      console.log("[refreshFromL2] Query result:", result);

      if (!result.success) {
        console.error("[refreshFromL2] Query failed:", result.error);
        setRefreshError(result.error ?? "Failed to query positions from L2");
        return;
      }

      // Convert L2 positions to PositionDisplay format
      const l2Positions: PositionDisplay[] = result.positions.map((p) => {
        const mappedStatus = mapL2StatusToIntentStatus(p.status);
        console.log(
          `[refreshFromL2] Position ${p.intentId.slice(0, 16)}... L2 status: ${p.status} -> IntentStatus: ${mappedStatus}`
        );
        return {
          intentId: p.intentId,
          assetId: p.assetId,
          shares: toBigIntString(p.shares),
          sharesFormatted: formatUSDC(p.shares),
          status: mappedStatus,
          deadline: p.deadline > 0n ? toBigIntString(p.deadline) : undefined,
          netAmount: p.netAmount > 0n ? toBigIntString(p.netAmount) : undefined,
        };
      });

      // Replace all positions with L2 data (L2 is source of truth)
      // Note: PendingWithdraw positions are filtered separately based on pending bridges
      console.log("[refreshFromL2] Setting", l2Positions.length, "positions in state");
      setPositions(l2Positions);

      // Clean up secrets for positions that no longer exist
      const l2IntentIds = new Set(l2Positions.map((p) => p.intentId));
      const allSecretKeys = getAllStoredSecretKeys();
      for (const key of allSecretKeys) {
        if (!l2IntentIds.has(key)) {
          removeSecret(key);
        }
      }
      console.log("[refreshFromL2] Refresh complete");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error refreshing positions";
      setRefreshError(errorMessage);
      console.error("[refreshFromL2] Error:", errorMessage, error);
    } finally {
      setIsRefreshing(false);
    }
  }

  /**
   * Filter out PendingWithdraw positions where tokens have been claimed.
   *
   * This queries L1 for the TokensDepositedToL2 event to find the bridge messageKey,
   * then checks if a secret exists for that messageKey. If no secret exists,
   * the tokens were claimed and the position is filtered out.
   *
   * @param publicClient - L1 public client for querying events
   * @param portalAddress - Portal contract address
   * @param l2WalletAddress - L2 wallet address for secret lookup
   */
  async function filterClaimedWithdrawals(
    publicClient: PublicClient<Transport, Chain>,
    portalAddress: Address,
    l2WalletAddress: string
  ): Promise<void> {
    console.log("[filterClaimedWithdrawals] START");
    console.log("[filterClaimedWithdrawals] portalAddress:", portalAddress);
    console.log("[filterClaimedWithdrawals] l2WalletAddress:", l2WalletAddress);

    const currentPositions = state.positions;
    console.log("[filterClaimedWithdrawals] Current positions count:", currentPositions.length);
    console.log(
      "[filterClaimedWithdrawals] Positions:",
      currentPositions.map((p) => ({
        intentId: `${p.intentId.slice(0, 16)}...`,
        status: p.status,
        statusName: IntentStatus[p.status],
      }))
    );

    const filteredPositions: PositionDisplay[] = [];

    // ABI for checking consumed withdrawal intents
    const consumedWithdrawIntentsAbi = [
      {
        name: "consumedWithdrawIntents",
        type: "function",
        stateMutability: "view",
        inputs: [{ type: "bytes32" }],
        outputs: [{ type: "bool" }],
      },
    ] as const;

    for (const pos of currentPositions) {
      const intentIdRaw = pos.intentId.startsWith("0x")
        ? (pos.intentId as Hex)
        : (`0x${pos.intentId}` as Hex);
      // Pad to 32 bytes for L1 contract calls (bytes32)
      const intentIdHex = pad(intentIdRaw, { size: 32 });

      // For ALL positions (not just PendingWithdraw), check if withdrawal was already consumed on L1
      // This handles the case where L2 state is stale but L1 already processed the withdrawal
      try {
        const alreadyConsumed = await publicClient.readContract({
          address: portalAddress,
          abi: consumedWithdrawIntentsAbi,
          functionName: "consumedWithdrawIntents",
          args: [intentIdHex],
        });

        if (alreadyConsumed) {
          console.log(
            `[filterClaimedWithdrawals] Filtering out already-consumed position: ${pos.intentId.slice(0, 16)}... (L1 withdrawal already executed)`
          );
          continue;
        }
      } catch (err) {
        console.warn(
          `[filterClaimedWithdrawals] Failed to check L1 consumed status for ${pos.intentId.slice(0, 16)}...`,
          err
        );
        // Continue with other checks if L1 query fails
      }

      // For PendingWithdraw positions, also check if tokens were claimed via bridge
      if (pos.status === IntentStatus.PendingWithdraw) {
        console.log(
          `[filterClaimedWithdrawals] Processing PendingWithdraw position: ${pos.intentId.slice(0, 16)}...`
        );

        // Query L1 for the bridge messageKey corresponding to this intentId
        console.log(`[filterClaimedWithdrawals] Querying L1 for intentId: ${intentIdHex}`);
        const messageKey = await getWithdrawalBridgeMessageKey(
          publicClient,
          portalAddress,
          intentIdHex
        );
        console.log(`[filterClaimedWithdrawals] Got messageKey: ${messageKey}`);

        if (messageKey) {
          // Check if there's a stored secret for this messageKey
          // If secret exists, tokens not yet claimed - keep the position
          // If no secret, tokens were claimed - filter out the position
          // Note: Normalize case since hex strings may differ in case between sources
          const normalizedKey = messageKey.toLowerCase();
          const secretExists = hasSecret(normalizedKey);
          console.log(
            `[filterClaimedWithdrawals] Position ${pos.intentId.slice(0, 16)}...: messageKey=${messageKey.slice(0, 18)}..., secretExists=${secretExists}`
          );
          if (!secretExists) {
            console.log(
              `[filterClaimedWithdrawals] Filtering out claimed position: ${pos.intentId.slice(0, 16)}...`
            );
            continue;
          }
        }
      } else {
        console.log(
          `[filterClaimedWithdrawals] Keeping non-PendingWithdraw position: ${pos.intentId.slice(0, 16)}... (status=${IntentStatus[pos.status]})`
        );
      }

      // Keep the position if:
      // - Withdrawal not consumed on L1
      // - (For PendingWithdraw) No TokensDepositedToL2 event found OR secret still exists
      filteredPositions.push(pos);
    }

    if (filteredPositions.length !== currentPositions.length) {
      console.log(
        `[filterClaimedWithdrawals] Filtered ${currentPositions.length - filteredPositions.length} claimed position(s)`
      );
      setPositions(filteredPositions);
    }
  }

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
   * Clear all positions and secrets
   */
  function clearAllPositions(): void {
    setPositions([]);
    clearAllSecrets();
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
    // L2 refresh
    refreshFromL2,
    isRefreshing,
    refreshError,
    // Post-refresh filtering
    filterClaimedWithdrawals,
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
 * Check if a position can be withdrawn (Confirmed status)
 */
export function canWithdraw(position: Position): boolean {
  return position.status === IntentStatus.Confirmed;
}

/**
 * Get status label for display
 */
export function getPositionStatusLabel(status: IntentStatus): string {
  switch (status) {
    case IntentStatus.PendingDeposit:
      return "Pending Deposit";
    case IntentStatus.Confirmed:
      return "Active";
    case IntentStatus.PendingWithdraw:
      return "Pending Withdrawal";
    case IntentStatus.Withdrawn:
      return "Withdrawn";
    default:
      return "Unknown";
  }
}
