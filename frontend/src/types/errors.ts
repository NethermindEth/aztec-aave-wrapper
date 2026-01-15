/**
 * Shared error types for flow operations
 *
 * These errors provide semantic meaning for different failure modes
 * and enable proper error handling and retry logic.
 */

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when user rejects a wallet transaction
 */
export class UserRejectedError extends Error {
  constructor(
    public readonly step: number,
    public readonly operation: string
  ) {
    super(`Transaction rejected by user during ${operation}`);
    this.name = "UserRejectedError";
  }

  /** User rejections are intentional and should not be retried */
  get isRetriable(): boolean {
    return false;
  }
}

/**
 * Error thrown on network/RPC failures
 */
export class NetworkError extends Error {
  constructor(
    public readonly step: number,
    public readonly operation: string,
    public readonly cause: unknown
  ) {
    const message = cause instanceof Error ? cause.message : "Unknown network error";
    super(`Network error during ${operation}: ${message}`);
    this.name = "NetworkError";
  }

  /** Network errors are typically transient and can be retried */
  get isRetriable(): boolean {
    return true;
  }
}

/**
 * Error thrown when an operation times out
 */
export class TimeoutError extends Error {
  constructor(
    public readonly step: number,
    public readonly operation: string,
    public readonly timeoutMs?: number
  ) {
    const timeoutInfo = timeoutMs !== undefined ? ` after ${timeoutMs}ms` : "";
    super(`Timeout${timeoutInfo} during ${operation}`);
    this.name = "TimeoutError";
  }

  /** Timeout errors may be retried as they could be transient */
  get isRetriable(): boolean {
    return true;
  }
}

// =============================================================================
// Error Detection Helpers
// =============================================================================

/**
 * Check if an error is a user rejection (wallet declined transaction)
 */
export function isUserRejection(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("user rejected") ||
    message.includes("user denied") ||
    message.includes("rejected by user") ||
    message.includes("user cancelled") ||
    message.includes("user canceled") ||
    message.includes("action_rejected")
  );
}

/**
 * Check if an error is a network/connection error
 */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("network") ||
    message.includes("connection") ||
    message.includes("econnrefused") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("fetch failed") ||
    message.includes("failed to fetch")
  );
}

/**
 * Check if an error is a timeout
 */
export function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("timeout") || message.includes("timed out");
}
