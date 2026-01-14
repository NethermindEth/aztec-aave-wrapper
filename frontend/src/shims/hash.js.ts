/**
 * Shim for hash.js to provide ESM default export
 *
 * hash.js is a CommonJS module that exports directly onto `exports`.
 * This shim re-exports it as ESM with a default export.
 *
 * Uses absolute path to bypass Vite alias resolution.
 */

// Import using relative path to frontend/node_modules to avoid alias loop
// @ts-expect-error - importing CommonJS module
import * as hashjs from "../../node_modules/hash.js/lib/hash.js";

// Re-export everything
export const utils = hashjs.utils;
export const common = hashjs.common;
export const sha = hashjs.sha;
export const ripemd = hashjs.ripemd;
export const hmac = hashjs.hmac;
export const sha1 = hashjs.sha1;
export const sha256 = hashjs.sha256;
export const sha224 = hashjs.sha224;
export const sha384 = hashjs.sha384;
export const sha512 = hashjs.sha512;
export const ripemd160 = hashjs.ripemd160;

// Default export for `import hash from 'hash.js'`
export default hashjs;
