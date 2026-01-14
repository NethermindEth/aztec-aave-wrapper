/**
 * Contract artifact loading utilities
 *
 * Provides browser-compatible loading of Foundry contract artifacts
 * (ABI and bytecode) for L1 contract deployment.
 *
 * Artifacts are copied to public/artifacts/ at build time and fetched at runtime.
 */

import type { Abi, Hex } from "viem";

/**
 * Contract artifact structure matching Foundry output format
 */
export interface ContractArtifact {
  abi: Abi;
  bytecode: Hex;
}

/**
 * Raw Foundry artifact structure
 */
interface FoundryArtifact {
  abi: Abi;
  bytecode: {
    object: string;
    sourceMap: string;
    linkReferences: Record<string, unknown>;
  };
}

/**
 * Supported contract names for artifact loading
 */
export type ContractName = "MockERC20" | "MockLendingPool" | "AztecAavePortalL1Simple";

/**
 * Cache for loaded artifacts to avoid redundant fetches
 */
const artifactCache = new Map<ContractName, ContractArtifact>();

/**
 * Load a contract artifact from the public artifacts directory
 *
 * @param contractName - Name of the contract to load
 * @returns Contract artifact with ABI and bytecode
 * @throws Error if artifact cannot be loaded or parsed
 */
export async function loadArtifact(contractName: ContractName): Promise<ContractArtifact> {
  // Check cache first
  const cached = artifactCache.get(contractName);
  if (cached) {
    return cached;
  }

  const url = `/artifacts/${contractName}.json`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(
      `Network error loading artifact for ${contractName}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Failed to load artifact for ${contractName}: ${response.status} ${response.statusText}`
    );
  }

  let foundryArtifact: FoundryArtifact;
  try {
    foundryArtifact = await response.json();
  } catch (error) {
    throw new Error(
      `Failed to parse artifact JSON for ${contractName}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Validate artifact structure
  if (!foundryArtifact.abi || !Array.isArray(foundryArtifact.abi)) {
    throw new Error(`Invalid artifact for ${contractName}: missing or invalid ABI`);
  }

  if (!foundryArtifact.bytecode?.object) {
    throw new Error(`Invalid artifact for ${contractName}: missing bytecode.object`);
  }

  // Extract and format bytecode
  let bytecode = foundryArtifact.bytecode.object;

  // Check for empty bytecode (interfaces or abstract contracts)
  if (bytecode === "" || bytecode === "0x") {
    throw new Error(
      `Invalid artifact for ${contractName}: bytecode is empty (is this an interface or abstract contract?)`
    );
  }

  // Check for unlinked library references (e.g., __$abc123...$__)
  if (bytecode.includes("__$")) {
    throw new Error(
      `Invalid artifact for ${contractName}: bytecode contains unlinked library references`
    );
  }
  if (!bytecode.startsWith("0x")) {
    bytecode = `0x${bytecode}`;
  }

  const artifact: ContractArtifact = {
    abi: foundryArtifact.abi,
    bytecode: bytecode as Hex,
  };

  // Cache the result
  artifactCache.set(contractName, artifact);

  return artifact;
}

/**
 * Preload all required artifacts
 *
 * Call this early in app initialization to warm the cache
 * and detect any missing artifacts upfront.
 *
 * @throws AggregateError if any artifacts fail to load, containing all individual errors
 */
export async function preloadArtifacts(): Promise<void> {
  const contracts: ContractName[] = ["MockERC20", "MockLendingPool", "AztecAavePortalL1Simple"];

  const results = await Promise.allSettled(contracts.map(loadArtifact));

  const failures = results
    .map((result, index) => ({ result, contract: contracts[index] }))
    .filter(
      (item): item is { result: PromiseRejectedResult; contract: ContractName } =>
        item.result.status === "rejected"
    );

  if (failures.length > 0) {
    const errors = failures.map(
      ({ result, contract }) =>
        new Error(
          `${contract}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
        )
    );
    throw new AggregateError(errors, `Failed to load ${failures.length} artifact(s)`);
  }
}

/**
 * Clear the artifact cache
 *
 * Useful for testing or when artifacts may have been updated.
 */
export function clearArtifactCache(): void {
  artifactCache.clear();
}
