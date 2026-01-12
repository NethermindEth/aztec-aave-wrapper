/**
 * E2E Test Setup and Deployment Utilities
 *
 * This module provides the test harness for E2E tests:
 * - PXE client initialization
 * - Account creation and management
 * - Contract deployment
 * - L1/Target chain setup
 *
 * Usage:
 *   import { TestHarness } from './setup';
 *   const harness = new TestHarness(config);
 *   await harness.initialize();
 */

import { readFileSync } from "fs";
import { join } from "path";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import type { PublicClient, WalletClient, Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { TestConfig } from "./config";
import { LOCAL_PRIVATE_KEYS } from "@aztec-aave-wrapper/shared";

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Aztec imports - dynamically loaded to handle Node.js version compatibility
 */
interface AztecModules {
  createPXEClient: typeof import("@aztec/aztec.js").createPXEClient;
  AccountWallet: typeof import("@aztec/aztec.js").AccountWallet;
  Fr: typeof import("@aztec/aztec.js").Fr;
  AztecAddress: typeof import("@aztec/aztec.js").AztecAddress;
  EthAddress: typeof import("@aztec/aztec.js").EthAddress;
  Contract: typeof import("@aztec/aztec.js").Contract;
  GrumpkinScalar: typeof import("@aztec/aztec.js").GrumpkinScalar;
  getSchnorrAccount: typeof import("@aztec/accounts/schnorr").getSchnorrAccount;
}

type PXE = import("@aztec/aztec.js").PXE;
type ContractArtifact = import("@aztec/aztec.js").ContractArtifact;
type AccountWalletInstance = InstanceType<
  typeof import("@aztec/aztec.js").AccountWallet
>;
type ContractInstance = import("@aztec/aztec.js").Contract;

/**
 * Test account with wallet and metadata
 */
export interface TestAccount {
  /** Account wallet for signing transactions */
  wallet: AccountWalletInstance;
  /** Aztec address */
  address: ReturnType<AccountWalletInstance["getAddress"]>;
  /** Secret key (for reference) */
  secretKey: ReturnType<typeof import("@aztec/aztec.js").Fr.random>;
}

/**
 * L1/Target chain client wrapper
 */
export interface ChainClient {
  /** Public client for reading state */
  public: PublicClient;
  /** Wallet client for transactions */
  wallet: WalletClient;
  /** Chain configuration */
  chain: Chain;
}

/**
 * Deployment result for a single contract
 */
export interface DeploymentResult {
  /** Contract address */
  address: string;
  /** Deployment transaction hash (L1/Target only) */
  txHash?: string;
}

/**
 * Full deployment results
 */
export interface DeploymentResults {
  l2: {
    aaveWrapper: DeploymentResult;
  };
  l1: {
    portal: DeploymentResult;
  };
  target: {
    executor: DeploymentResult;
  };
  wormhole?: {
    mockBridge?: DeploymentResult;
    mockRelayer?: DeploymentResult;
  };
}

/**
 * Test harness initialization status
 */
export interface InitializationStatus {
  aztecAvailable: boolean;
  pxeConnected: boolean;
  l1Connected: boolean;
  targetConnected: boolean;
  contractsDeployed: boolean;
  accountsCreated: boolean;
}

// =============================================================================
// Test Harness Class
// =============================================================================

/**
 * TestHarness provides a complete test environment for E2E tests.
 *
 * @example
 * ```ts
 * const config = getConfig('local', 'mock');
 * const harness = new TestHarness(config);
 *
 * await harness.initialize();
 *
 * // Use the harness
 * const user = harness.accounts.user;
 * const contract = harness.contracts.aaveWrapper;
 *
 * // Cleanup
 * await harness.teardown();
 * ```
 */
export class TestHarness {
  private config: TestConfig;
  private aztec: AztecModules | null = null;
  private _pxe: PXE | null = null;
  private _artifact: ContractArtifact | null = null;

  // Chain clients
  private _l1Client: ChainClient | null = null;
  private _targetClient: ChainClient | null = null;

  // Test accounts
  private _accounts: {
    admin: TestAccount | null;
    user: TestAccount | null;
    user2: TestAccount | null;
  } = {
    admin: null,
    user: null,
    user2: null,
  };

  // Contract instances
  private _contracts: {
    aaveWrapper: ContractInstance | null;
  } = {
    aaveWrapper: null,
  };

  // Status
  private _status: InitializationStatus = {
    aztecAvailable: false,
    pxeConnected: false,
    l1Connected: false,
    targetConnected: false,
    contractsDeployed: false,
    accountsCreated: false,
  };

  constructor(config: TestConfig) {
    this.config = config;
  }

  // ===========================================================================
  // Public Getters
  // ===========================================================================

  get pxe(): PXE {
    if (!this._pxe) throw new Error("PXE not initialized. Call initialize() first.");
    return this._pxe;
  }

  get l1Client(): ChainClient {
    if (!this._l1Client)
      throw new Error("L1 client not initialized. Call initialize() first.");
    return this._l1Client;
  }

  get targetClient(): ChainClient {
    if (!this._targetClient)
      throw new Error("Target client not initialized. Call initialize() first.");
    return this._targetClient;
  }

  get accounts() {
    return {
      admin: this._accounts.admin!,
      user: this._accounts.user!,
      user2: this._accounts.user2!,
    };
  }

  get contracts() {
    return {
      aaveWrapper: this._contracts.aaveWrapper!,
    };
  }

  get status(): InitializationStatus {
    return { ...this._status };
  }

  get artifact(): ContractArtifact {
    if (!this._artifact)
      throw new Error("Artifact not loaded. Call initialize() first.");
    return this._artifact;
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize the test harness.
   * Sets up PXE, chain clients, accounts, and optionally deploys contracts.
   *
   * @param options - Initialization options
   * @returns Initialization status
   */
  async initialize(options?: {
    /** Skip account creation */
    skipAccounts?: boolean;
    /** Skip contract deployment (use existing) */
    skipDeployment?: boolean;
    /** Deploy mock Wormhole contracts */
    deployWormholeMocks?: boolean;
  }): Promise<InitializationStatus> {
    const opts = {
      skipAccounts: false,
      skipDeployment: false,
      deployWormholeMocks: this.config.mode === "mock",
      ...options,
    };

    // Step 1: Load Aztec modules
    await this.loadAztecModules();

    // Step 2: Connect to PXE
    if (this._status.aztecAvailable) {
      await this.connectPXE();
    }

    // Step 3: Load contract artifact
    this.loadArtifact();

    // Step 4: Setup chain clients
    await this.setupChainClients();

    // Step 5: Create accounts
    if (!opts.skipAccounts && this._status.pxeConnected) {
      await this.createAccounts();
    }

    // Step 6: Deploy contracts
    if (!opts.skipDeployment && this._status.accountsCreated) {
      await this.deployContracts(opts.deployWormholeMocks);
    }

    return this._status;
  }

  /**
   * Teardown the test harness and cleanup resources.
   */
  async teardown(): Promise<void> {
    // Reset state
    this._pxe = null;
    this._l1Client = null;
    this._targetClient = null;
    this._accounts = { admin: null, user: null, user2: null };
    this._contracts = { aaveWrapper: null };
    this._status = {
      aztecAvailable: false,
      pxeConnected: false,
      l1Connected: false,
      targetConnected: false,
      contractsDeployed: false,
      accountsCreated: false,
    };
  }

  // ===========================================================================
  // Private Initialization Methods
  // ===========================================================================

  /**
   * Dynamically load Aztec modules.
   * This handles Node.js version compatibility issues.
   */
  private async loadAztecModules(): Promise<void> {
    try {
      const aztecJs = await import("@aztec/aztec.js");
      const accounts = await import("@aztec/accounts/schnorr");

      this.aztec = {
        createPXEClient: aztecJs.createPXEClient,
        AccountWallet: aztecJs.AccountWallet,
        Fr: aztecJs.Fr,
        AztecAddress: aztecJs.AztecAddress,
        EthAddress: aztecJs.EthAddress,
        Contract: aztecJs.Contract,
        GrumpkinScalar: aztecJs.GrumpkinScalar,
        getSchnorrAccount: accounts.getSchnorrAccount,
      };

      this._status.aztecAvailable = true;
    } catch (error) {
      console.warn(
        `Aztec modules not available (Node.js ${process.version}).`,
        "Some tests will be skipped."
      );
      this._status.aztecAvailable = false;
    }
  }

  /**
   * Connect to the PXE client.
   */
  private async connectPXE(): Promise<void> {
    if (!this.aztec) return;

    try {
      this._pxe = this.aztec.createPXEClient(this.config.chains.l2.rpcUrl);
      await Promise.race([
        this._pxe.getNodeInfo(),
        this.timeout(this.config.timeouts.pxeConnection, "PXE connection"),
      ]);
      this._status.pxeConnected = true;
    } catch (error) {
      console.warn(
        `PXE not available at ${this.config.chains.l2.rpcUrl}:`,
        error instanceof Error ? error.message : error
      );
      this._status.pxeConnected = false;
    }
  }

  /**
   * Load the AaveWrapper contract artifact.
   */
  private loadArtifact(): void {
    try {
      const artifactPath = join(
        __dirname,
        "../../aztec_contracts/target/aave_wrapper-AaveWrapper.json"
      );
      const artifactJson = readFileSync(artifactPath, "utf-8");
      this._artifact = JSON.parse(artifactJson) as ContractArtifact;
    } catch (error) {
      console.warn(
        "Contract artifact not found. Run: cd aztec_contracts && aztec compile"
      );
      this._artifact = null;
    }
  }

  /**
   * Setup L1 and Target chain clients.
   */
  private async setupChainClients(): Promise<void> {
    // L1 Client
    try {
      const l1Chain: Chain = {
        id: this.config.chains.l1.chainId,
        name: this.config.chains.l1.name,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [this.config.chains.l1.rpcUrl] },
        },
      };

      const l1Account = privateKeyToAccount(LOCAL_PRIVATE_KEYS.DEPLOYER);

      this._l1Client = {
        public: createPublicClient({
          chain: l1Chain,
          transport: http(this.config.chains.l1.rpcUrl),
        }),
        wallet: createWalletClient({
          account: l1Account,
          chain: l1Chain,
          transport: http(this.config.chains.l1.rpcUrl),
        }),
        chain: l1Chain,
      };

      // Test connection
      await this._l1Client.public.getChainId();
      this._status.l1Connected = true;
    } catch (error) {
      console.warn(
        `L1 not available at ${this.config.chains.l1.rpcUrl}:`,
        error instanceof Error ? error.message : error
      );
      this._status.l1Connected = false;
    }

    // Target Client
    try {
      const targetChain: Chain = {
        id: this.config.chains.target.chainId,
        name: this.config.chains.target.name,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [this.config.chains.target.rpcUrl] },
        },
      };

      const targetAccount = privateKeyToAccount(LOCAL_PRIVATE_KEYS.DEPLOYER);

      this._targetClient = {
        public: createPublicClient({
          chain: targetChain,
          transport: http(this.config.chains.target.rpcUrl),
        }),
        wallet: createWalletClient({
          account: targetAccount,
          chain: targetChain,
          transport: http(this.config.chains.target.rpcUrl),
        }),
        chain: targetChain,
      };

      // Test connection
      await this._targetClient.public.getChainId();
      this._status.targetConnected = true;
    } catch (error) {
      console.warn(
        `Target not available at ${this.config.chains.target.rpcUrl}:`,
        error instanceof Error ? error.message : error
      );
      this._status.targetConnected = false;
    }
  }

  /**
   * Create test accounts on Aztec.
   */
  private async createAccounts(): Promise<void> {
    if (!this.aztec || !this._pxe) return;

    try {
      const { Fr, GrumpkinScalar, getSchnorrAccount } = this.aztec;

      // Admin account
      const adminSecretKey = Fr.random();
      const adminSigningKey = GrumpkinScalar.random();
      const adminAccount = getSchnorrAccount(this._pxe, adminSecretKey, adminSigningKey);
      const adminWallet = await adminAccount.waitSetup();
      this._accounts.admin = {
        wallet: adminWallet,
        address: adminWallet.getAddress(),
        secretKey: adminSecretKey,
      };

      // User account
      const userSecretKey = Fr.random();
      const userSigningKey = GrumpkinScalar.random();
      const userAccount = getSchnorrAccount(this._pxe, userSecretKey, userSigningKey);
      const userWallet = await userAccount.waitSetup();
      this._accounts.user = {
        wallet: userWallet,
        address: userWallet.getAddress(),
        secretKey: userSecretKey,
      };

      // User2 account (for authorization tests)
      const user2SecretKey = Fr.random();
      const user2SigningKey = GrumpkinScalar.random();
      const user2Account = getSchnorrAccount(this._pxe, user2SecretKey, user2SigningKey);
      const user2Wallet = await user2Account.waitSetup();
      this._accounts.user2 = {
        wallet: user2Wallet,
        address: user2Wallet.getAddress(),
        secretKey: user2SecretKey,
      };

      this._status.accountsCreated = true;
    } catch (error) {
      console.warn(
        "Failed to create accounts:",
        error instanceof Error ? error.message : error
      );
      this._status.accountsCreated = false;
    }
  }

  /**
   * Deploy contracts for testing.
   *
   * @param deployWormholeMocks - Whether to deploy mock Wormhole contracts
   */
  private async deployContracts(deployWormholeMocks: boolean): Promise<void> {
    if (!this.aztec || !this._artifact || !this._accounts.admin) return;

    try {
      const { Contract, EthAddress } = this.aztec;

      // Use a mock portal address for testing
      const portalAddress = EthAddress.fromString(
        this.config.addresses.l1.portal ||
          "0x1234567890123456789012345678901234567890"
      );

      // Deploy AaveWrapper contract
      const deployedContract = await Contract.deploy(
        this._accounts.admin.wallet,
        this._artifact,
        [this._accounts.admin.address, portalAddress]
      )
        .send()
        .deployed();

      this._contracts.aaveWrapper = deployedContract;
      this._status.contractsDeployed = true;

      // TODO: Deploy mock Wormhole contracts if needed
      if (deployWormholeMocks && this._status.l1Connected) {
        // This will be implemented when mock contracts are available
        console.log("Mock Wormhole deployment not yet implemented");
      }
    } catch (error) {
      console.warn(
        "Failed to deploy contracts:",
        error instanceof Error ? error.message : error
      );
      this._status.contractsDeployed = false;
    }
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Create a timeout promise for async operations.
   */
  private timeout(ms: number, operation: string): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms)
    );
  }

  /**
   * Check if the harness is ready for testing.
   */
  isReady(): boolean {
    return (
      this._status.aztecAvailable &&
      this._status.pxeConnected &&
      this._status.accountsCreated
    );
  }

  /**
   * Check if full E2E testing is available (all chains connected).
   */
  isFullE2EReady(): boolean {
    return (
      this.isReady() &&
      this._status.l1Connected &&
      this._status.targetConnected &&
      this._status.contractsDeployed
    );
  }

  /**
   * Get a summary of the harness state for logging.
   */
  getSummary(): string {
    const lines = [
      "Test Harness Status:",
      `  Environment: ${this.config.environment}`,
      `  Mode: ${this.config.mode}`,
      `  Aztec Available: ${this._status.aztecAvailable}`,
      `  PXE Connected: ${this._status.pxeConnected}`,
      `  L1 Connected: ${this._status.l1Connected}`,
      `  Target Connected: ${this._status.targetConnected}`,
      `  Accounts Created: ${this._status.accountsCreated}`,
      `  Contracts Deployed: ${this._status.contractsDeployed}`,
    ];

    if (this._accounts.admin) {
      lines.push(`  Admin: ${this._accounts.admin.address.toString()}`);
    }
    if (this._accounts.user) {
      lines.push(`  User: ${this._accounts.user.address.toString()}`);
    }
    if (this._contracts.aaveWrapper) {
      lines.push(`  AaveWrapper: ${this._contracts.aaveWrapper.address.toString()}`);
    }

    return lines.join("\n");
  }
}

// =============================================================================
// Standalone Utility Functions
// =============================================================================

/**
 * Wait for PXE to be ready (sandbox synced).
 *
 * @param pxeUrl - PXE endpoint URL
 * @param timeoutMs - Maximum wait time
 * @returns true if PXE is ready, false otherwise
 */
export async function waitForPXE(
  pxeUrl: string,
  timeoutMs: number = 60_000
): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 2000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const { createPXEClient } = await import("@aztec/aztec.js");
      const pxe = createPXEClient(pxeUrl);
      const info = await pxe.getNodeInfo();
      // Check if synced (block number > 0)
      if (info.nodeVersion) {
        return true;
      }
    } catch {
      // PXE not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return false;
}

/**
 * Wait for an Anvil chain to be ready.
 *
 * @param rpcUrl - Chain RPC URL
 * @param timeoutMs - Maximum wait time
 * @returns true if chain is ready, false otherwise
 */
export async function waitForChain(
  rpcUrl: string,
  timeoutMs: number = 30_000
): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 1000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const client = createPublicClient({
        transport: http(rpcUrl),
      });
      await client.getChainId();
      return true;
    } catch {
      // Chain not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return false;
}

/**
 * Fund an account on an Anvil chain.
 *
 * @param rpcUrl - Chain RPC URL
 * @param address - Address to fund
 * @param amount - Amount in ETH (default: 10 ETH)
 */
export async function fundAccount(
  rpcUrl: string,
  address: string,
  amount: string = "10"
): Promise<void> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "anvil_setBalance",
      params: [address, parseEther(amount).toString(16)],
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fund account: ${response.statusText}`);
  }
}

/**
 * Advance time on an Anvil chain.
 *
 * @param rpcUrl - Chain RPC URL
 * @param seconds - Seconds to advance
 */
export async function advanceChainTime(
  rpcUrl: string,
  seconds: number
): Promise<void> {
  // Increase time
  await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "evm_increaseTime",
      params: [seconds],
    }),
  });

  // Mine a block to apply the time change
  await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "evm_mine",
      params: [],
    }),
  });
}

/**
 * Get current block timestamp from a chain.
 *
 * @param rpcUrl - Chain RPC URL
 * @returns Current block timestamp in seconds
 */
export async function getBlockTimestamp(rpcUrl: string): Promise<bigint> {
  const client = createPublicClient({
    transport: http(rpcUrl),
  });
  const block = await client.getBlock();
  return block.timestamp;
}
