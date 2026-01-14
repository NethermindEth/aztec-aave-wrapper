/**
 * Store action functions
 *
 * Action functions that modify store state using setState.
 * All mutations use path syntax for fine-grained reactivity.
 */

import type { Address, AztecAddress } from "@aztec-aave-wrapper/shared";
import type { OperationStatus, OperationType } from "../types/operations.js";
import type {
  ContractsState,
  L1ConnectionState,
  L2ConnectionState,
  LogEntry,
  LogLevel,
  OperationState,
  PositionDisplay,
  WalletState,
} from "../types/state.js";
import { setState } from "./state.js";

// =============================================================================
// L1 Connection Actions
// =============================================================================

/**
 * Set L1 connection state
 */
export function setL1Connection(connection: Partial<L1ConnectionState>): void {
  if (connection.connected !== undefined) {
    setState("l1", "connected", connection.connected);
  }
  if (connection.chainId !== undefined) {
    setState("l1", "chainId", connection.chainId);
  }
  if (connection.blockNumber !== undefined) {
    setState("l1", "blockNumber", connection.blockNumber);
  }
}

/**
 * Update L1 block number
 */
export function setL1BlockNumber(blockNumber: number): void {
  setState("l1", "blockNumber", blockNumber);
}

// =============================================================================
// L2 Connection Actions
// =============================================================================

/**
 * Set L2 connection state
 */
export function setL2Connection(connection: Partial<L2ConnectionState>): void {
  if (connection.connected !== undefined) {
    setState("l2", "connected", connection.connected);
  }
  if (connection.nodeVersion !== undefined) {
    setState("l2", "nodeVersion", connection.nodeVersion);
  }
  if (connection.blockNumber !== undefined) {
    setState("l2", "blockNumber", connection.blockNumber);
  }
}

/**
 * Update L2 block number
 */
export function setL2BlockNumber(blockNumber: number): void {
  setState("l2", "blockNumber", blockNumber);
}

// =============================================================================
// Wallet Actions
// =============================================================================

/**
 * Set wallet state
 */
export function setWallet(wallet: Partial<WalletState>): void {
  if (wallet.l1Address !== undefined) {
    setState("wallet", "l1Address", wallet.l1Address);
  }
  if (wallet.l2Address !== undefined) {
    setState("wallet", "l2Address", wallet.l2Address);
  }
  if (wallet.ethBalance !== undefined) {
    setState("wallet", "ethBalance", wallet.ethBalance);
  }
  if (wallet.usdcBalance !== undefined) {
    setState("wallet", "usdcBalance", wallet.usdcBalance);
  }
  if (wallet.aTokenBalance !== undefined) {
    setState("wallet", "aTokenBalance", wallet.aTokenBalance);
  }
}

/**
 * Set ETH balance (as string)
 */
export function setEthBalance(balance: string): void {
  setState("wallet", "ethBalance", balance);
}

/**
 * Set L1 wallet address
 */
export function setL1Address(address: Address | null): void {
  setState("wallet", "l1Address", address);
}

/**
 * Set L2 wallet address
 */
export function setL2Address(address: AztecAddress | null): void {
  setState("wallet", "l2Address", address);
}

/**
 * Update USDC balance (as string)
 */
export function setUsdcBalance(balance: string): void {
  setState("wallet", "usdcBalance", balance);
}

/**
 * Update aToken balance (as string)
 */
export function setATokenBalance(balance: string): void {
  setState("wallet", "aTokenBalance", balance);
}

// =============================================================================
// Contract Actions
// =============================================================================

/**
 * Set contract addresses
 */
export function setContracts(contracts: Partial<ContractsState>): void {
  if (contracts.portal !== undefined) {
    setState("contracts", "portal", contracts.portal);
  }
  if (contracts.mockUsdc !== undefined) {
    setState("contracts", "mockUsdc", contracts.mockUsdc);
  }
  if (contracts.mockLendingPool !== undefined) {
    setState("contracts", "mockLendingPool", contracts.mockLendingPool);
  }
  if (contracts.l2Wrapper !== undefined) {
    setState("contracts", "l2Wrapper", contracts.l2Wrapper);
  }
}

// =============================================================================
// Operation Actions
// =============================================================================

/**
 * Start a new operation
 */
export function startOperation(type: OperationType, totalSteps: number): void {
  setState("operation", {
    type,
    step: 1,
    totalSteps,
    status: "pending",
    intentId: null,
    error: null,
    logs: [],
  });
}

/**
 * Update operation step
 */
export function setOperationStep(step: number): void {
  setState("operation", "step", step);
}

/**
 * Update operation status
 */
export function setOperationStatus(status: OperationStatus): void {
  setState("operation", "status", status);
}

/**
 * Set operation intent ID
 */
export function setOperationIntentId(intentId: string): void {
  setState("operation", "intentId", intentId);
}

/**
 * Set operation error
 */
export function setOperationError(error: string): void {
  setState("operation", "error", error);
  setState("operation", "status", "error");
}

/** Maximum number of log entries to retain */
const MAX_LOG_ENTRIES = 100;

/**
 * Add log entry to operation
 */
export function addOperationLog(level: LogLevel, message: string, txHash?: string): void {
  const entry: LogEntry = {
    timestamp: Date.now(),
    level,
    message,
    txHash,
  };
  setState("operation", "logs", (logs) => {
    const newLogs = [...logs, entry];
    // Trim oldest entries if exceeding max limit to prevent memory issues
    if (newLogs.length > MAX_LOG_ENTRIES) {
      return newLogs.slice(newLogs.length - MAX_LOG_ENTRIES);
    }
    return newLogs;
  });
}

/**
 * Clear current operation (reset to idle)
 */
export function clearOperation(): void {
  setState("operation", {
    type: "idle",
    step: 0,
    totalSteps: 0,
    status: "pending",
    intentId: null,
    error: null,
    logs: [],
  });
}

/**
 * Update multiple operation fields at once
 */
export function updateOperation(updates: Partial<OperationState>): void {
  if (updates.type !== undefined) {
    setState("operation", "type", updates.type);
  }
  if (updates.step !== undefined) {
    setState("operation", "step", updates.step);
  }
  if (updates.totalSteps !== undefined) {
    setState("operation", "totalSteps", updates.totalSteps);
  }
  if (updates.status !== undefined) {
    setState("operation", "status", updates.status);
  }
  if (updates.intentId !== undefined) {
    setState("operation", "intentId", updates.intentId);
  }
  if (updates.error !== undefined) {
    setState("operation", "error", updates.error);
  }
  if (updates.logs !== undefined) {
    setState("operation", "logs", updates.logs);
  }
}

// =============================================================================
// Position Actions
// =============================================================================

/**
 * Set all positions (replaces existing)
 */
export function setPositions(positions: PositionDisplay[]): void {
  setState("positions", positions);
}

/**
 * Add a new position
 */
export function addPosition(position: PositionDisplay): void {
  setState("positions", (positions) => [...positions, position]);
}

/**
 * Update an existing position by intent ID
 */
export function updatePosition(intentId: string, updates: Partial<PositionDisplay>): void {
  setState("positions", (pos) => pos.intentId === intentId, updates);
}

/**
 * Remove a position by intent ID
 */
export function removePosition(intentId: string): void {
  setState("positions", (positions) => positions.filter((p) => p.intentId !== intentId));
}

// =============================================================================
// Batch/Reset Actions
// =============================================================================

/**
 * Reset all state to initial values
 */
export function resetState(): void {
  setState("l1", {
    connected: false,
    chainId: 0,
    blockNumber: 0,
  });
  setState("l2", {
    connected: false,
    nodeVersion: "",
    blockNumber: 0,
  });
  setState("wallet", {
    l1Address: null,
    l2Address: null,
    ethBalance: "0",
    usdcBalance: "0",
    aTokenBalance: "0",
  });
  setState("contracts", {
    portal: null,
    mockUsdc: null,
    mockLendingPool: null,
    l2Wrapper: null,
  });
  setState("operation", {
    type: "idle",
    step: 0,
    totalSteps: 0,
    status: "pending",
    intentId: null,
    error: null,
    logs: [],
  });
  setState("positions", []);
}
