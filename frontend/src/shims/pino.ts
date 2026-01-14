/**
 * Pino browser shim for Vite compatibility
 *
 * Pino's browser.js uses CommonJS exports which causes issues with ESM imports.
 * This shim provides a minimal browser-compatible logger with proper ESM exports.
 */

type LogFn = (msg: string, ...args: unknown[]) => void;

interface Logger {
  level: string;
  levels: typeof levels;
  fatal: LogFn;
  error: LogFn;
  warn: LogFn;
  info: LogFn;
  verbose: LogFn;
  debug: LogFn;
  trace: LogFn;
  silent: LogFn;
  child: (bindings: Record<string, unknown>) => Logger;
}

interface PinoOptions {
  level?: string;
  browser?: {
    asObject?: boolean;
    write?: Record<string, LogFn> | LogFn;
  };
}

// Additional exports that pino provides
export const stdSerializers = {
  req: (req: unknown) => req,
  res: (res: unknown) => res,
  err: (err: unknown) => err,
};

export const levels = {
  values: {
    fatal: 60,
    error: 50,
    warn: 40,
    info: 30,
    verbose: 25,
    debug: 20,
    trace: 10,
  },
  labels: {
    60: "fatal",
    50: "error",
    40: "warn",
    30: "info",
    25: "verbose",
    20: "debug",
    10: "trace",
  },
};

// Pino symbols used internally
export const symbols = {
  needsMetadataGsym: Symbol("pino.metadata"),
  setLevelSym: Symbol("pino.setLevel"),
  getLevelSym: Symbol("pino.getLevel"),
  levelValSym: Symbol("pino.levelVal"),
  useLevelLabelsSym: Symbol("pino.useLevelLabels"),
  mixinSym: Symbol("pino.mixin"),
  lsCacheSym: Symbol("pino.lsCache"),
  chindingsSym: Symbol("pino.chindings"),
  parsedChindingsSym: Symbol("pino.parsedChindings"),
  asJsonSym: Symbol("pino.asJson"),
  writeSym: Symbol("pino.write"),
  serializersSym: Symbol("pino.serializers"),
  redactFmtSym: Symbol("pino.redactFmt"),
  timeSym: Symbol("pino.time"),
  timeSliceIndexSym: Symbol("pino.timeSliceIndex"),
  streamSym: Symbol("pino.stream"),
  stringifySym: Symbol("pino.stringify"),
  stringifiersSym: Symbol("pino.stringifiers"),
  endSym: Symbol("pino.end"),
  formatOptsSym: Symbol("pino.formatOpts"),
  messageKeySym: Symbol("pino.messageKey"),
  nestedKeySym: Symbol("pino.nestedKey"),
  wildcardFirstSym: Symbol("pino.wildcardFirst"),
  formattersSym: Symbol("pino.formatters"),
  hooksSym: Symbol("pino.hooks"),
};

function createLogger(options: PinoOptions = {}): Logger {
  const level = options.level || "info";

  const noop: LogFn = () => {};

  const levelNames = ["fatal", "error", "warn", "info", "verbose", "debug", "trace"];
  const levelIndex = levelNames.indexOf(level);

  const shouldLog = (targetLevel: string): boolean => {
    const targetIndex = levelNames.indexOf(targetLevel);
    return targetIndex <= levelIndex;
  };

  const createLogFn = (targetLevel: string): LogFn => {
    if (!shouldLog(targetLevel)) return noop;

    const consoleFn =
      targetLevel === "fatal" || targetLevel === "error"
        ? console.error
        : targetLevel === "warn"
          ? console.warn
          : targetLevel === "debug" || targetLevel === "trace"
            ? console.debug
            : console.log;

    return (msg: string, ...args: unknown[]) => {
      consoleFn(`[${targetLevel.toUpperCase()}]`, msg, ...args);
    };
  };

  const logger: Logger = {
    level,
    levels,
    fatal: createLogFn("fatal"),
    error: createLogFn("error"),
    warn: createLogFn("warn"),
    info: createLogFn("info"),
    verbose: createLogFn("verbose"),
    debug: createLogFn("debug"),
    trace: createLogFn("trace"),
    silent: noop,
    child: (_bindings: Record<string, unknown>) => createLogger(options),
  };

  return logger;
}

// Pino function with attached properties (like the real pino)
interface PinoFactory {
  (options?: PinoOptions): Logger;
  levels: typeof levels;
  stdSerializers: typeof stdSerializers;
  symbols: typeof symbols;
}

// Create the pino function with properties attached
const pinoFactory = createLogger as PinoFactory;
pinoFactory.levels = levels;
pinoFactory.stdSerializers = stdSerializers;
pinoFactory.symbols = symbols;

// Named export (for `import { pino } from 'pino'`)
export const pino = pinoFactory;

// Default export (for `import pino from 'pino'`)
export default pinoFactory;
