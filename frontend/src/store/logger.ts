/**
 * Operation logging system
 *
 * Provides structured logging for operation progress display.
 * Matches console output patterns from full-flow.ts.
 */

import type { LogLevel } from "../types/state.js";
import { setState, state } from "./state.js";

// =============================================================================
// Constants
// =============================================================================

/**
 * Maximum number of log entries to retain.
 * Prevents memory issues from log accumulation.
 */
export const MAX_LOG_ENTRIES = 100;

// =============================================================================
// Re-export LogEntry type for convenience
// =============================================================================

export type { LogEntry, LogLevel } from "../types/state.js";

// =============================================================================
// Timestamp Formatting
// =============================================================================

/**
 * Format timestamp for display (HH:MM:SS format)
 * Matches the pattern used in full-flow.ts
 */
export function formatLogTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(11, 19);
}

/**
 * Format timestamp with milliseconds for precise timing
 */
export function formatLogTimestampWithMs(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(11, 23);
}

// =============================================================================
// Logging Actions
// =============================================================================

/**
 * Add a log entry to the operation log.
 * Automatically enforces MAX_LOG_ENTRIES limit.
 */
export function log(level: LogLevel, message: string, txHash?: string): void {
  const entry = {
    timestamp: Date.now(),
    level,
    message,
    txHash,
  };

  setState("operation", "logs", (logs) => {
    const newLogs = [...logs, entry];
    // Trim oldest entries if exceeding max limit
    if (newLogs.length > MAX_LOG_ENTRIES) {
      return newLogs.slice(newLogs.length - MAX_LOG_ENTRIES);
    }
    return newLogs;
  });
}

/**
 * Log an info-level message
 */
export function logInfo(message: string, txHash?: string): void {
  log("info", message, txHash);
}

/**
 * Log a success-level message
 */
export function logSuccess(message: string, txHash?: string): void {
  log("success", message, txHash);
}

/**
 * Log a warning-level message
 */
export function logWarning(message: string, txHash?: string): void {
  log("warning", message, txHash);
}

/**
 * Log an error-level message
 */
export function logError(message: string, txHash?: string): void {
  log("error", message, txHash);
}

/**
 * Log a step in the operation process.
 * Format: "Step X/Y: description"
 */
export function logStep(step: number, totalSteps: number, description: string): void {
  log("info", `Step ${step}/${totalSteps}: ${description}`);
}

/**
 * Log with section prefix.
 * Format: "[section] message"
 */
export function logSection(section: string, message: string, level: LogLevel = "info"): void {
  log(level, `[${section}] ${message}`);
}

/**
 * Clear all operation logs
 */
export function clearLogs(): void {
  setState("operation", "logs", []);
}

/**
 * Get formatted log entries for display.
 * Returns logs with formatted timestamps.
 */
export function getFormattedLogs(): Array<{
  timestamp: string;
  level: LogLevel;
  message: string;
  txHash?: string;
}> {
  return state.operation.logs.map((entry) => ({
    timestamp: formatLogTimestamp(entry.timestamp),
    level: entry.level,
    message: entry.message,
    txHash: entry.txHash,
  }));
}

/**
 * Get the current log count
 */
export function getLogCount(): number {
  return state.operation.logs.length;
}
