/**
 * LogViewer Component
 *
 * Displays operation logs with timestamps and automatic scroll-to-bottom behavior.
 * Respects user scrolling by only auto-scrolling when already at the bottom.
 */

import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { TransactionLink } from "./TransactionLink";

/**
 * Log level for categorizing log messages
 */
export enum LogLevel {
  INFO = "info",
  SUCCESS = "success",
  WARNING = "warning",
  ERROR = "error",
}

/**
 * Log entry structure
 */
export interface LogEntry {
  /** Unique identifier for the log entry */
  id: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Log message text */
  message: string;
  /** Log level for styling */
  level: LogLevel;
  /** Optional transaction hash for linking to block explorer */
  txHash?: string;
  /** Optional chain ID for selecting correct block explorer */
  chainId?: number;
}

/**
 * Props for LogViewer component
 */
export interface LogViewerProps {
  /** Array of log entries to display */
  logs: LogEntry[];
  /** Optional title for the log viewer panel */
  title?: string;
  /** Optional maximum height in pixels (default: 300) */
  maxHeight?: number;
  /** Optional: CSS class for the container */
  class?: string;
}

/**
 * Format timestamp for display (HH:MM:SS.mmm)
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  const ms = date.getMilliseconds().toString().padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

/**
 * Get CSS classes for log level styling
 */
function getLogLevelClasses(level: LogLevel): string {
  switch (level) {
    case LogLevel.SUCCESS:
      return "text-green-600 dark:text-green-400";
    case LogLevel.WARNING:
      return "text-yellow-600 dark:text-yellow-400";
    case LogLevel.ERROR:
      return "text-red-600 dark:text-red-400";
    default:
      return "text-foreground";
  }
}

/**
 * LogViewer renders a scrollable panel of log entries with timestamps.
 *
 * Features:
 * - Auto-scrolls to bottom when new logs are added (if user is at bottom)
 * - Respects user scroll position (won't fight manual scrolling)
 * - Color-coded log levels (info, success, warning, error)
 * - Monospace font for readability
 * - Virtualization-ready structure (renders only visible items)
 *
 * @example
 * ```tsx
 * const [logs, setLogs] = createSignal<LogEntry[]>([]);
 *
 * // Add a log entry
 * setLogs(prev => [...prev, {
 *   id: crypto.randomUUID(),
 *   timestamp: Date.now(),
 *   message: "Operation started",
 *   level: LogLevel.INFO,
 * }]);
 *
 * <LogViewer
 *   logs={logs()}
 *   title="Operation Logs"
 *   maxHeight={400}
 * />
 * ```
 */
export function LogViewer(props: LogViewerProps) {
  let scrollContainerRef: HTMLDivElement | undefined;
  const [isAtBottom, setIsAtBottom] = createSignal(true);

  const maxHeight = () => props.maxHeight ?? 300;

  /**
   * Check if scroll is at the bottom (within 10px tolerance)
   */
  const checkIfAtBottom = () => {
    if (!scrollContainerRef) return true;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef;
    return scrollHeight - scrollTop - clientHeight < 10;
  };

  /**
   * Handle scroll events to track user position
   */
  const handleScroll = () => {
    setIsAtBottom(checkIfAtBottom());
  };

  /**
   * Scroll to bottom of the log container
   */
  const scrollToBottom = () => {
    if (scrollContainerRef) {
      scrollContainerRef.scrollTop = scrollContainerRef.scrollHeight;
    }
  };

  // Auto-scroll when new logs are added (only if already at bottom)
  createEffect(() => {
    // Access logs to create dependency
    const logCount = props.logs.length;

    if (logCount > 0 && isAtBottom()) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    }
  });

  // Cleanup scroll listener
  onCleanup(() => {
    if (scrollContainerRef) {
      scrollContainerRef.removeEventListener("scroll", handleScroll);
    }
  });

  return (
    <Card class={props.class}>
      <CardHeader class="pb-2">
        <CardTitle class="text-sm font-medium">{props.title ?? "Logs"}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          class="overflow-y-auto rounded border bg-muted/50 p-2 font-mono text-xs"
          style={{ "max-height": `${maxHeight()}px` }}
        >
          <Show
            when={props.logs.length > 0}
            fallback={<div class="py-4 text-center text-muted-foreground">No logs yet</div>}
          >
            <For each={props.logs}>
              {(log) => (
                <div class="flex flex-wrap items-start gap-2 py-0.5">
                  <span class="shrink-0 text-muted-foreground">
                    [{formatTimestamp(log.timestamp)}]
                  </span>
                  <span class={getLogLevelClasses(log.level)}>{log.message}</span>
                  <Show when={log.txHash}>
                    <span class="shrink-0 text-muted-foreground">
                      tx: <TransactionLink txHash={log.txHash!} chainId={log.chainId} truncate />
                    </span>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </div>
        <Show when={!isAtBottom() && props.logs.length > 0}>
          <button
            type="button"
            onClick={scrollToBottom}
            class="mt-2 w-full rounded border border-dashed py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            Scroll to bottom
          </button>
        </Show>
      </CardContent>
    </Card>
  );
}
