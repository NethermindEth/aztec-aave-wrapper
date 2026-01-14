/**
 * Dynamic Aztec SDK module loader
 *
 * Loads Aztec SDK modules dynamically to support WASM dependencies
 * in the browser environment. Modules are loaded on-demand to optimize
 * initial bundle size and handle async WASM initialization.
 */

/**
 * Type definitions for dynamically loaded Aztec modules
 */
export interface AztecModules {
  Fr: typeof import('@aztec/aztec.js/fields').Fr;
  AztecAddress: typeof import('@aztec/aztec.js/addresses').AztecAddress;
  createAztecNodeClient: typeof import('@aztec/aztec.js/node').createAztecNodeClient;
  waitForNode: typeof import('@aztec/aztec.js/node').waitForNode;
  computeSecretHash: typeof import('@aztec/stdlib/hash').computeSecretHash;
  poseidon2Hash: typeof import('@aztec/foundation/crypto/poseidon').poseidon2Hash;
}

let cachedModules: AztecModules | null = null;

/**
 * Dynamically loads all required Aztec SDK modules.
 *
 * Uses dynamic imports to load WASM-dependent modules at runtime,
 * allowing proper initialization in browser environments. Results
 * are cached to avoid repeated module loading.
 *
 * @returns Promise resolving to loaded Aztec modules
 */
export async function loadAztecModules(): Promise<AztecModules> {
  if (cachedModules) {
    return cachedModules;
  }

  const [fieldsModule, addressesModule, nodeModule, hashModule, cryptoModule] =
    await Promise.all([
      import('@aztec/aztec.js/fields'),
      import('@aztec/aztec.js/addresses'),
      import('@aztec/aztec.js/node'),
      import('@aztec/stdlib/hash'),
      import('@aztec/foundation/crypto/poseidon'),
    ]);

  cachedModules = {
    Fr: fieldsModule.Fr,
    AztecAddress: addressesModule.AztecAddress,
    createAztecNodeClient: nodeModule.createAztecNodeClient,
    waitForNode: nodeModule.waitForNode,
    computeSecretHash: hashModule.computeSecretHash,
    poseidon2Hash: cryptoModule.poseidon2Hash,
  };

  return cachedModules;
}

/**
 * Clears the cached modules.
 * Useful for testing or when module reload is needed.
 */
export function clearModuleCache(): void {
  cachedModules = null;
}

/**
 * Checks if Aztec modules have been loaded.
 */
export function isAztecLoaded(): boolean {
  return cachedModules !== null;
}
