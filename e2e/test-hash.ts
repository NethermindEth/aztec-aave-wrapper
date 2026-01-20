import { poseidon2Hash } from "@aztec/aztec.js";
import { Fr } from "@aztec/aztec.js/fields";

// Secret from the logs (hex string) - full secret
const secretHex = '0x1e854bca85aa63d4e992218ba62f74c4d9cc9995bfb10be1eb90f3e7dde3a73d';
const secretBigInt = BigInt(secretHex);

console.log('Secret (bigint):', secretBigInt.toString());
console.log('Secret (hex):', '0x' + secretBigInt.toString(16));

// Compute hash
const hash = await poseidon2Hash([secretBigInt]);
console.log('Computed secretHash:', hash.toString());
console.log('Expected secretHash from L1: 0x235af7c0db886948c1c62bc3312970ae4d14639e58bfd536d8f225b3eecfe6a1');

// Check if they match
const expectedHex = '0x235af7c0db886948c1c62bc3312970ae4d14639e58bfd536d8f225b3eecfe6a1';
const expected = BigInt(expectedHex);
const computed = hash.toBigInt();
console.log('Match:', computed === expected);
