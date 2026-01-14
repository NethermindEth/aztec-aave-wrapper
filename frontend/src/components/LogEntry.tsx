/**
 * LogEntry Component
 *
 * Displays an individual log entry with timestamp, optional section, and message.
 * Supports displaying additional data objects in a readable format.
 */

import { For, Show } from "solid-js";

/**
 * Log level for categorizing log messages
 */
export type LogLevel = "info" | "success" | "warning" | "error";

/**
 * Props for LogEntry component
 */
export interface LogEntryProps {
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Log message text */
  message: string;
  /** Log level for styling */
  level: LogLevel;
  /** Optional section/category label */
  section?: string;
  /** Optional data object to display */
  data?: Record<string, unknown>;
  /** Optional transaction hash */
  txHash?: string;
}

/**
 * Format timestamp for display (HH:MM:SS.mmm)
 * Matches console output format
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
    case "success":
      return "text-green-600 dark:text-green-400";
    case "warning":
      return "text-yellow-600 dark:text-yellow-400";
    case "error":
      return "text-red-600 dark:text-red-400";
    default:
      return "text-foreground";
  }
}

/**
 * Format a data value for display
 */
function formatDataValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value.toString();
  if (Array.isArray(value)) {
    return `[${value.map(formatDataValue).join(", ")}]`;
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "[Object]";
    }
  }
  return String(value);
}

/**
 * Parse section from message if present.
 * Messages may contain sections in format: "[section] message"
 */
function parseSection(message: string): { section?: string; content: string } {
  const match = message.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (match) {
    return { section: match[1], content: match[2] };
  }
  return { content: message };
}

/**
 * LogEntry renders a single log entry with timestamp, optional section, and message.
 *
 * Features:
 * - Timestamp in console format (HH:MM:SS.mmm)
 * - Optional section badge
 * - Color-coded log levels
 * - Expandable data object display
 * - Transaction hash display with truncation
 *
 * @example
 * ```tsx
 * <LogEntry
 *   timestamp={Date.now()}
 *   level="info"
 *   message="Operation started"
 * />
 *
 * <LogEntry
 *   timestamp={Date.now()}
 *   level="success"
 *   section="L1"
 *   message="Transaction confirmed"
 *   txHash="0x1234...abcd"
 *   data={{ blockNumber: 12345, gasUsed: 21000 }}
 * />
 * ```
 */
export function LogEntry(props: LogEntryProps) {
  // Parse section from message if not provided explicitly
  const parsed = () => {
    if (props.section) {
      return { section: props.section, content: props.message };
    }
    return parseSection(props.message);
  };

  const dataEntries = () => {
    if (!props.data) return [];
    return Object.entries(props.data);
  };

  return (
    <div class="py-0.5">
      <div class="flex flex-wrap items-start gap-2">
        {/* Timestamp */}
        <span class="shrink-0 text-muted-foreground">[{formatTimestamp(props.timestamp)}]</span>

        {/* Section badge */}
        <Show when={parsed().section}>
          <span class="shrink-0 rounded bg-muted px-1 text-muted-foreground">
            {parsed().section}
          </span>
        </Show>

        {/* Message content */}
        <span class={getLogLevelClasses(props.level)}>{parsed().content}</span>

        {/* Transaction hash */}
        <Show when={props.txHash}>
          <span class="shrink-0 text-muted-foreground">
            tx:{" "}
            <span class="font-mono text-blue-600 dark:text-blue-400">
              {props.txHash!.slice(0, 10)}...{props.txHash!.slice(-8)}
            </span>
          </span>
        </Show>
      </div>

      {/* Data object display */}
      <Show when={dataEntries().length > 0}>
        <div class="ml-4 mt-1 rounded bg-muted/30 p-2 text-muted-foreground">
          <For each={dataEntries()}>
            {([key, value]) => (
              <div class="flex gap-2">
                <span class="shrink-0 font-medium">{key}:</span>
                <span class="break-all">{formatDataValue(value)}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
