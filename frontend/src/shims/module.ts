/**
 * Shim for Node.js module built-in
 *
 * Provides browser-compatible stub for createRequire and other module functions.
 * createRequire is not available in browsers, so we provide a no-op that throws
 * a helpful error if actually called.
 */

// Minimal type for browser shim - avoids strict NodeRequire type checking
interface BrowserRequire {
  (id: string): never;
  resolve: ((id: string) => never) & { paths: (request: string) => null };
  cache: Record<string, unknown>;
  extensions: Record<string, unknown>;
  main: undefined;
}

/**
 * Stub for createRequire - not available in browsers
 * Returns a function that throws when called
 */
export function createRequire(_url: string | URL): BrowserRequire {
  const requireFn = function require(id: string): never {
    throw new Error(
      `Cannot require("${id}") in browser environment. createRequire is a Node.js-only API.`
    );
  } as BrowserRequire;

  const resolveFn = function resolve(id: string): never {
    throw new Error(`Cannot require.resolve("${id}") in browser environment.`);
  } as BrowserRequire["resolve"];

  resolveFn.paths = function paths(_request: string): null {
    return null;
  };

  requireFn.resolve = resolveFn;
  requireFn.cache = {};
  requireFn.extensions = {};
  requireFn.main = undefined;

  return requireFn;
}

// Default export for CommonJS-style imports
export default {
  createRequire,
};
