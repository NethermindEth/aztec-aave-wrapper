/**
 * Logger Hook
 *
 * Manages operation logging with automatic entry capping.
 * Provides a reactive log signal and addLog function.
 */

import { type Accessor, createSignal } from "solid-js";
import { type LogEntry, LogLevel } from "../../components/LogViewer";

/** Maximum number of log entries to retain */
const MAX_LOG_ENTRIES = 300;

export interface UseLoggerResult {
  /** Reactive accessor for log entries */
  logs: Accessor<LogEntry[]>;
  /** Add a new log entry */
  addLog: (message: string, level?: LogLevel) => void;
}

/**
 * Hook for managing operation logs.
 *
 * Automatically caps log entries to MAX_LOG_ENTRIES to prevent memory issues.
 * Each log entry includes a unique ID and timestamp.
 *
 * @returns Logger state and addLog function
 *
 * @example
 * const { logs, addLog } = useLogger();
 * addLog("Starting operation...");
 * addLog("Operation complete!", LogLevel.SUCCESS);
 */
export function useLogger(): UseLoggerResult {
  const [logs, setLogs] = createSignal<LogEntry[]>([]);

  const addLog = (message: string, level: LogLevel = LogLevel.INFO) => {
    setLogs((prev) =>
      [
        ...prev,
        {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          message,
          level,
        },
      ].slice(-MAX_LOG_ENTRIES)
    );
  };

  return { logs, addLog };
}
