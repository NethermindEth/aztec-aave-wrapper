/**
 * Browser shim for Node.js async_hooks module
 *
 * Provides a minimal AsyncLocalStorage implementation for browser environments.
 */

/**
 * Minimal AsyncLocalStorage implementation for browsers
 * Used by Aztec SDK for context propagation
 */
export class AsyncLocalStorage<T> {
  private store: T | undefined;

  run<R>(store: T, callback: () => R): R {
    const previous = this.store;
    this.store = store;
    try {
      return callback();
    } finally {
      this.store = previous;
    }
  }

  getStore(): T | undefined {
    return this.store;
  }

  disable(): void {
    this.store = undefined;
  }

  enterWith(store: T): void {
    this.store = store;
  }

  exit<R>(callback: () => R): R {
    const previous = this.store;
    this.store = undefined;
    try {
      return callback();
    } finally {
      this.store = previous;
    }
  }
}

/**
 * Minimal AsyncResource implementation
 */
export class AsyncResource {
  runInAsyncScope<R>(fn: () => R): R {
    return fn();
  }

  emitDestroy(): this {
    return this;
  }

  asyncId(): number {
    return 0;
  }

  triggerAsyncId(): number {
    return 0;
  }
}

export function executionAsyncId(): number {
  return 0;
}

export function triggerAsyncId(): number {
  return 0;
}

export function createHook(_options: object): { enable(): void; disable(): void } {
  return {
    enable() {},
    disable() {},
  };
}

export default {
  AsyncLocalStorage,
  AsyncResource,
  executionAsyncId,
  triggerAsyncId,
  createHook,
};
