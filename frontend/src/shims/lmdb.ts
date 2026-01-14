/**
 * Shim for lmdb (Lightning Memory-Mapped Database)
 *
 * lmdb is a native Node.js module that cannot run in browsers.
 * This shim provides stub exports that throw helpful errors.
 * Browser code should use IndexedDB instead.
 */

const NOT_SUPPORTED_MSG = "lmdb is not supported in browser environment. Use IndexedDB instead.";

export function open(): never {
  throw new Error(NOT_SUPPORTED_MSG);
}

export class Database {
  constructor() {
    throw new Error(NOT_SUPPORTED_MSG);
  }
}

export class RootDatabase {
  constructor() {
    throw new Error(NOT_SUPPORTED_MSG);
  }
}

export default {
  open,
  Database,
  RootDatabase,
};
