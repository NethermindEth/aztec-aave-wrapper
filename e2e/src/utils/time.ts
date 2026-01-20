/**
 * Time utilities for deterministic test execution.
 *
 * This module addresses the DETERMINISM audit rule by providing:
 * - Controlled time sources for deadline generation
 * - Explicit expired deadline helpers
 * - Configurable base time for reproducible tests
 *
 * Usage:
 *   import { TestClock, deadlineFromOffset, expiredDeadline } from './utils/time';
 *
 *   // Use singleton clock for all deadline generation
 *   const deadline = TestClock.deadlineFromOffset(3600); // 1 hour from test start
 *
 *   // Or create isolated clock for specific test
 *   const clock = new TestClock(1704067200); // Fixed timestamp
 *   const deadline = clock.deadlineFromOffset(60);
 */

/**
 * TestClock provides deterministic time handling for tests.
 *
 * By default, captures the time when the test suite starts and uses that
 * as the base for all deadline calculations. This prevents race conditions
 * where Date.now() changes between deadline creation and validation.
 */
export class TestClock {
  private baseTime: number;

  /**
   * Create a new TestClock.
   *
   * @param baseTimeSeconds - Optional fixed base time (Unix timestamp in seconds).
   *                          If not provided, captures current time at construction.
   */
  constructor(baseTimeSeconds?: number) {
    this.baseTime = baseTimeSeconds ?? Math.floor(Date.now() / 1000);
  }

  /**
   * Get the base time for this clock (Unix timestamp in seconds).
   */
  getBaseTime(): number {
    return this.baseTime;
  }

  /**
   * Get the base time as bigint.
   */
  getBaseTimeBigInt(): bigint {
    return BigInt(this.baseTime);
  }

  /**
   * Create a deadline that's `offsetSeconds` after the base time.
   *
   * @param offsetSeconds - Seconds to add to base time
   * @returns Deadline timestamp as bigint
   */
  deadlineFromOffset(offsetSeconds: number): bigint {
    return BigInt(this.baseTime + offsetSeconds);
  }

  /**
   * Create an already-expired deadline.
   *
   * @param secondsAgo - How many seconds before base time (default: 1)
   * @returns Expired deadline timestamp as bigint
   */
  expiredDeadline(secondsAgo: number = 1): bigint {
    return BigInt(this.baseTime - secondsAgo);
  }

  /**
   * Create a deadline at the minimum valid offset (5 minutes per CLAUDE.md).
   *
   * @returns Deadline at minimum valid offset
   */
  minimumValidDeadline(): bigint {
    return this.deadlineFromOffset(5 * 60); // 5 minutes
  }

  /**
   * Create a deadline at the maximum valid offset (24 hours per CLAUDE.md).
   *
   * @returns Deadline at maximum valid offset
   */
  maximumValidDeadline(): bigint {
    return this.deadlineFromOffset(24 * 60 * 60); // 24 hours
  }

  /**
   * Check if a deadline is in the future relative to base time.
   *
   * @param deadline - Deadline to check
   * @returns true if deadline > baseTime
   */
  isDeadlineValid(deadline: bigint): boolean {
    return deadline > BigInt(this.baseTime);
  }

  /**
   * Check if a deadline has expired relative to base time.
   *
   * @param deadline - Deadline to check
   * @returns true if deadline <= baseTime
   */
  isDeadlineExpired(deadline: bigint): boolean {
    return deadline <= BigInt(this.baseTime);
  }

  /**
   * Advance the clock by the specified seconds.
   * Useful for simulating time passage in tests.
   *
   * @param seconds - Seconds to advance
   */
  advance(seconds: number): void {
    this.baseTime += seconds;
  }

  /**
   * Get a timestamp representing "now" for the test clock.
   * This is the base time, not the actual current time.
   */
  now(): bigint {
    return BigInt(this.baseTime);
  }

  /**
   * Get a timestamp in the future for refund/cancel testing.
   *
   * @param secondsAfterDeadline - Seconds after a given deadline
   * @param deadline - The deadline to be past
   * @returns Timestamp after the deadline
   */
  timeAfterDeadline(deadline: bigint, secondsAfterDeadline: number = 1): bigint {
    return deadline + BigInt(secondsAfterDeadline);
  }
}

/**
 * Singleton clock instance for the test suite.
 * Initialized when the module loads, providing consistent time across all tests.
 */
let suiteClock: TestClock | null = null;

/**
 * Get or create the suite-level clock.
 * The clock is created once per test run and reused.
 */
export function getSuiteClock(): TestClock {
  if (!suiteClock) {
    suiteClock = new TestClock();
  }
  return suiteClock;
}

/**
 * Reset the suite clock (useful for test isolation).
 * Should be called in beforeAll if tests need a fresh clock.
 */
export function resetSuiteClock(): TestClock {
  suiteClock = new TestClock();
  return suiteClock;
}

/**
 * Create a deadline offset from the suite clock's base time.
 * Convenience function that uses the singleton clock.
 *
 * @param offsetSeconds - Seconds from suite start
 * @returns Deadline timestamp
 */
export function deadlineFromOffset(offsetSeconds: number): bigint {
  return getSuiteClock().deadlineFromOffset(offsetSeconds);
}

/**
 * Create an expired deadline relative to suite clock.
 * Convenience function for testing deadline validation.
 *
 * @param secondsAgo - How far in the past (default: 1)
 * @returns Expired deadline timestamp
 */
export function expiredDeadline(secondsAgo: number = 1): bigint {
  return getSuiteClock().expiredDeadline(secondsAgo);
}

/**
 * Polling configuration for async operations.
 */
export interface PollConfig {
  /** Maximum time to wait in milliseconds */
  timeoutMs: number;
  /** Interval between polls in milliseconds */
  intervalMs: number;
  /** Description for error messages */
  description?: string;
}

/**
 * Default polling configuration for note discovery.
 */
export const DEFAULT_NOTE_DISCOVERY_CONFIG: PollConfig = {
  timeoutMs: 15000, // 15 seconds max
  intervalMs: 1000, // Poll every second
  description: "note discovery",
};

/**
 * Poll until a condition is met or timeout expires.
 *
 * @param condition - Async function that returns true when done
 * @param config - Polling configuration
 * @returns true if condition was met, false if timed out
 */
export async function pollUntil(
  condition: () => Promise<boolean>,
  config: PollConfig = DEFAULT_NOTE_DISCOVERY_CONFIG
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < config.timeoutMs) {
    try {
      if (await condition()) {
        return true;
      }
    } catch {
      // Condition threw, continue polling
    }
    await sleep(config.intervalMs);
  }

  return false;
}

/**
 * Sleep for a specified duration.
 *
 * @param ms - Milliseconds to sleep
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for note discovery with configurable timeout.
 * Replaces hardcoded sleeps with bounded polling.
 *
 * @param checkBalance - Function to check if notes are discovered
 * @param config - Optional polling configuration
 * @returns true if notes discovered, false if timed out
 */
export async function waitForNoteDiscovery(
  checkBalance?: () => Promise<boolean>,
  config: PollConfig = DEFAULT_NOTE_DISCOVERY_CONFIG
): Promise<boolean> {
  if (checkBalance) {
    return pollUntil(checkBalance, config);
  }

  // Fallback: fixed wait when no condition provided
  // This is still better than unbounded sleep because it's configurable
  await sleep(config.timeoutMs);
  return true;
}
