/**
 * Shim for sha3 to provide ESM exports
 *
 * sha3 is a CommonJS module. This shim re-exports it as ESM.
 */

import * as sha3Module from "../../node_modules/sha3/index.js";

// Named exports
export const Keccak = sha3Module.Keccak;
export const SHA3 = sha3Module.SHA3;
export const SHAKE = sha3Module.SHAKE;
export const SHA3Hash = sha3Module.SHA3Hash;

// Default export
export default sha3Module.default || sha3Module.SHA3;
