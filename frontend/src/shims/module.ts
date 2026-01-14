/**
 * Shim for Node.js module built-in
 *
 * Provides browser-compatible stub for createRequire and other module functions.
 * createRequire is not available in browsers, so we provide a no-op that throws
 * a helpful error if actually called.
 */

/**
 * Stub for createRequire - not available in browsers
 * Returns a function that throws when called
 */
export function createRequire(_url: string | URL): NodeRequire {
  const requireFn = function require(id: string): never {
    throw new Error(
      `Cannot require("${id}") in browser environment. createRequire is a Node.js-only API.`
    );
  } as NodeRequire;

  requireFn.resolve = function resolve(id: string): never {
    throw new Error(`Cannot require.resolve("${id}") in browser environment.`);
  } as NodeRequire["resolve"];

  requireFn.resolve.paths = function paths(_request: string): null {
    return null;
  };

  requireFn.cache = {};
  requireFn.extensions = {};
  requireFn.main = undefined;

  return requireFn;
}

// Default export for CommonJS-style imports
export default {
  createRequire,
};
