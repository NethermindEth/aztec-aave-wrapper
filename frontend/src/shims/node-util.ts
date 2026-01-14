/**
 * Browser shim for Node.js util module
 *
 * Provides minimal implementations for commonly used util functions.
 */

/**
 * Minimal inspect implementation for browsers
 * Returns JSON representation of object
 */
export function inspect(obj: unknown, _options?: object): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

/**
 * Stub for promisify - returns identity function
 */
export function promisify<T extends (...args: unknown[]) => unknown>(fn: T): T {
  return fn;
}

/**
 * Stub for deprecate - returns original function
 */
export function deprecate<T extends (...args: unknown[]) => unknown>(fn: T, _msg: string): T {
  return fn;
}

/**
 * Format string with substitution
 */
export function format(fmt: string, ...args: unknown[]): string {
  let i = 0;
  return fmt.replace(/%[sdjoO%]/g, (match) => {
    if (match === "%%") return "%";
    if (i >= args.length) return match;
    const arg = args[i++];
    switch (match) {
      case "%s":
        return String(arg);
      case "%d":
        return Number(arg).toString();
      case "%j":
        return JSON.stringify(arg);
      case "%o":
      case "%O":
        return inspect(arg);
      default:
        return match;
    }
  });
}

/**
 * Type checking utilities
 */
export const types = {
  isDate: (obj: unknown): obj is Date => obj instanceof Date,
  isRegExp: (obj: unknown): obj is RegExp => obj instanceof RegExp,
  isArray: Array.isArray,
  isBoolean: (obj: unknown): obj is boolean => typeof obj === "boolean",
  isNull: (obj: unknown): obj is null => obj === null,
  isNumber: (obj: unknown): obj is number => typeof obj === "number",
  isString: (obj: unknown): obj is string => typeof obj === "string",
  isUndefined: (obj: unknown): obj is undefined => obj === undefined,
  isFunction: (obj: unknown): obj is (...args: unknown[]) => unknown => typeof obj === "function",
  isObject: (obj: unknown): obj is object => typeof obj === "object" && obj !== null,
};

export default {
  inspect,
  promisify,
  deprecate,
  format,
  types,
};
