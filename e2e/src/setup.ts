/**
 * E2E Test Setup and Deployment Utilities
 *
 * This module provides the test harness for E2E tests:
 * - Node client initialization (3.0.0+ SDK)
 * - Account creation and management
 * - Contract deployment
 * - L1 chain setup
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
 * Aztec imports for 3.0.0 SDK - dynamically loaded to handle Node.js version compatibility
 */
interface AztecModules {
  // From @aztec/aztec.js/node
  createAztecNodeClient: (url: string) => AztecNode;
  waitForNode: (node: AztecNode) => Promise<void>;
  // From @aztec/aztec.js/fields
  Fr: typeof import("@aztec/aztec.js/fields").Fr;
  GrumpkinScalar: typeof import("@aztec/aztec.js/fields").GrumpkinScalar;
  // From @aztec/aztec.js/addresses
  AztecAddress: typeof import("@aztec/aztec.js/addresses").AztecAddress;
  EthAddress: typeof import("@aztec/foundation/eth-address").EthAddress;
  // From @aztec/aztec.js/contracts
  Contract: typeof import("@aztec/aztec.js/contracts").Contract;
  // From @aztec/aztec.js/wallet
  AccountManager: typeof import("@aztec/aztec.js/wallet").AccountManager;
  // From @aztec/accounts/schnorr
  SchnorrAccountContract: typeof import("@aztec/accounts/schnorr").SchnorrAccountContract;
  // From @aztec/accounts/testing
  getInitialTestAccountsData: typeof import("@aztec/accounts/testing").getInitialTestAccountsData;
}

// AztecNode type from stdlib
type AztecNode = import("@aztec/stdlib/interfaces/client").AztecNode;
type ContractArtifact = import("@aztec/stdlib/abi").ContractArtifact;
type AccountWithSecretKey = import("@aztec/aztec.js/account").AccountWithSecretKey;
type ContractInstance = import("@aztec/aztec.js/contracts").Contract;
type FrType = import("@aztec/aztec.js/fields").Fr;

/**
 * Test account with wallet and metadata
 */
export interface TestAccount {
  /** Account (implements Wallet interface) */
  wallet: AccountWithSecretKey;
  /** Aztec address */
  address: import("@aztec/aztec.js/addresses").AztecAddress;
  /** Secret key (for reference) */
  secretKey: FrType;
}

/**
 * L1 chain client wrapper
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
  /** Deployment transaction hash (L1 only) */
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
}

/**
 * Test harness initialization status
 */
export interface InitializationStatus {
  aztecAvailable: boolean;
  pxeConnected: boolean;
  l1Connected: boolean;
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
  private _node: AztecNode | null = null;
  private _artifact: ContractArtifact | null = null;

  // Chain clients
  private _l1Client: ChainClient | null = null;

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
    contractsDeployed: false,
    accountsCreated: false,
  };

  constructor(config: TestConfig) {
    this.config = config;
  }

  // ===========================================================================
  // Public Getters
  // ===========================================================================

  get pxe(): AztecNode {
    if (!this._node) throw new Error("Node not initialized. Call initialize() first.");
    return this._node;
  }

  get l1Client(): ChainClient {
    if (!this._l1Client)
      throw new Error("L1 client not initialized. Call initialize() first.");
    return this._l1Client;
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
   * Sets up node client, chain clients, accounts, and optionally deploys contracts.
   *
   * @param options - Initialization options
   * @returns Initialization status
   */
  async initialize(options?: {
    /** Skip account creation */
    skipAccounts?: boolean;
    /** Skip contract deployment (use existing) */
    skipDeployment?: boolean;
  }): Promise<InitializationStatus> {
    const opts = {
      skipAccounts: false,
      skipDeployment: false,
      ...options,
    };

    // Step 1: Load Aztec modules
    await this.loadAztecModules();

    // Step 2: Connect to Node
    if (this._status.aztecAvailable) {
      await this.connectNode();
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
      await this.deployContracts();
    }

    return this._status;
  }

  /**
   * Teardown the test harness and cleanup resources.
   */
  async teardown(): Promise<void> {
    // Reset state
    this._node = null;
    this._l1Client = null;
    this._accounts = { admin: null, user: null, user2: null };
    this._contracts = { aaveWrapper: null };
    this._status = {
      aztecAvailable: false,
      pxeConnected: false,
      l1Connected: false,
      contractsDeployed: false,
      accountsCreated: false,
    };
  }

  // ===========================================================================
  // Private Initialization Methods
  // ===========================================================================

  /**
   * Dynamically load Aztec modules (3.0.0 SDK).
   * This handles Node.js version compatibility issues.
   */
  private async loadAztecModules(): Promise<void> {
    try {
      // 3.0.0 SDK uses subpath exports
      const nodeModule = await import("@aztec/aztec.js/node");
      const fieldsModule = await import("@aztec/aztec.js/fields");
      const addressesModule = await import("@aztec/aztec.js/addresses");
      const contractsModule = await import("@aztec/aztec.js/contracts");
      const walletModule = await import("@aztec/aztec.js/wallet");
      const accountsSchnorr = await import("@aztec/accounts/schnorr");
      const accountsTesting = await import("@aztec/accounts/testing");
      const foundationEth = await import("@aztec/foundation/eth-address");

      this.aztec = {
        createAztecNodeClient: nodeModule.createAztecNodeClient,
        waitForNode: nodeModule.waitForNode,
        Fr: fieldsModule.Fr,
        GrumpkinScalar: fieldsModule.GrumpkinScalar,
        AztecAddress: addressesModule.AztecAddress,
        EthAddress: foundationEth.EthAddress,
        Contract: contractsModule.Contract,
        AccountManager: walletModule.AccountManager,
        SchnorrAccountContract: accountsSchnorr.SchnorrAccountContract,
        getInitialTestAccountsData: accountsTesting.getInitialTestAccountsData,
      };

      this._status.aztecAvailable = true;
    } catch (error) {
      console.warn(
        `Aztec modules not available (Node.js ${process.version}).`,
        "Some tests will be skipped.",
        error instanceof Error ? error.message : error
      );
      this._status.aztecAvailable = false;
    }
  }

  /**
   * Connect to the Aztec node (3.0.0+ uses createAztecNodeClient instead of createPXEClient).
   */
  private async connectNode(): Promise<void> {
    if (!this.aztec) return;

    try {
      this._node = this.aztec.createAztecNodeClient(this.config.chains.l2.rpcUrl);

      // Wait for node to be ready
      await Promise.race([
        this.aztec.waitForNode(this._node),
        this.timeout(this.config.timeouts.pxeConnection, "Node connection"),
      ]);

      // Verify connection by getting node info
      const nodeInfo = await this._node.getNodeInfo();
      console.log(`Connected to Aztec node version ${nodeInfo.nodeVersion}`);

      this._status.pxeConnected = true;
    } catch (error) {
      console.warn(
        `Aztec node not available at ${this.config.chains.l2.rpcUrl}:`,
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
   * Setup L1 chain client.
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
  }

  /**
   * Create test accounts on Aztec (3.0.0 SDK).
   *
   * Uses TestWallet with pre-funded sandbox accounts from @aztec/accounts/testing.
   * Each account gets its own TestWallet for independent transactions.
   */
  private async createAccounts(): Promise<void> {
    if (!this.aztec || !this._node) return;

    try {
      // Import TestWallet and pre-funded account keys
      const { TestWallet } = await import("@aztec/test-wallet/server");
      const {
        INITIAL_TEST_SECRET_KEYS,
        INITIAL_TEST_SIGNING_KEYS,
        INITIAL_TEST_ACCOUNT_SALTS,
      } = await import("@aztec/accounts/testing");

      // Verify we have enough pre-funded accounts
      if (
        INITIAL_TEST_SECRET_KEYS.length < 3 ||
        INITIAL_TEST_SIGNING_KEYS.length < 3 ||
        INITIAL_TEST_ACCOUNT_SALTS.length < 3
      ) {
        console.warn("Not enough pre-configured test accounts available");
        this._status.accountsCreated = false;
        return;
      }

      // Create TestWallet for admin
      const adminWallet = await TestWallet.create(this._node!, { proverEnabled: false });
      const adminAccountManager = await adminWallet.createSchnorrAccount(
        INITIAL_TEST_SECRET_KEYS[0]!,
        INITIAL_TEST_ACCOUNT_SALTS[0]!,
        INITIAL_TEST_SIGNING_KEYS[0]!
      );

      this._accounts.admin = {
        wallet: adminWallet as unknown as AccountWithSecretKey,
        address: adminAccountManager.address,
        secretKey: INITIAL_TEST_SECRET_KEYS[0]!,
      };

      // Create TestWallet for user
      const userWallet = await TestWallet.create(this._node!, { proverEnabled: false });
      const userAccountManager = await userWallet.createSchnorrAccount(
        INITIAL_TEST_SECRET_KEYS[1]!,
        INITIAL_TEST_ACCOUNT_SALTS[1]!,
        INITIAL_TEST_SIGNING_KEYS[1]!
      );

      this._accounts.user = {
        wallet: userWallet as unknown as AccountWithSecretKey,
        address: userAccountManager.address,
        secretKey: INITIAL_TEST_SECRET_KEYS[1]!,
      };

      // Create TestWallet for user2 (relayer)
      const user2Wallet = await TestWallet.create(this._node!, { proverEnabled: false });
      const user2AccountManager = await user2Wallet.createSchnorrAccount(
        INITIAL_TEST_SECRET_KEYS[2]!,
        INITIAL_TEST_ACCOUNT_SALTS[2]!,
        INITIAL_TEST_SIGNING_KEYS[2]!
      );

      this._accounts.user2 = {
        wallet: user2Wallet as unknown as AccountWithSecretKey,
        address: user2AccountManager.address,
        secretKey: INITIAL_TEST_SECRET_KEYS[2]!,
      };

      this._status.accountsCreated = true;

      console.log("Using pre-funded sandbox accounts:");
      console.log("  Admin:", this._accounts.admin.address.toString());
      console.log("  User:", this._accounts.user.address.toString());
      console.log("  User2/Relayer:", this._accounts.user2.address.toString());
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
   */
  private async deployContracts(): Promise<void> {
    if (!this.aztec || !this._artifact || !this._accounts.admin) return;

    try {
      // Import the generated contract wrapper
      const { AaveWrapperContract, AaveWrapperContractArtifact } = await import(
        "../../aztec_contracts/generated/AaveWrapper"
      );
      const { EthAddress } = await import("@aztec/foundation/eth-address");

      const adminWallet = this._accounts.admin.wallet;
      const adminAddress = this._accounts.admin.address;

      // Use a mock portal address for testing
      const portalAddress = EthAddress.fromString("0x1234567890123456789012345678901234567890");

      console.log("Deploying AaveWrapper contract...");

      // Deploy using the generated type-safe contract
      const deployedContract = await AaveWrapperContract.deploy(
        adminWallet,
        adminAddress,
        portalAddress
      )
        .send({ from: adminAddress })
        .deployed();

      // Store the deployed contract
      this._contracts.aaveWrapper = deployedContract as unknown as ContractInstance;

      // Register the contract with other wallets
      const contractInstance = await this._node!.getContract(deployedContract.address);
      if (contractInstance && this._accounts.user?.wallet && this._accounts.user2?.wallet) {
        await (this._accounts.user.wallet as any).registerContract(
          contractInstance,
          AaveWrapperContractArtifact
        );
        await (this._accounts.user2.wallet as any).registerContract(
          contractInstance,
          AaveWrapperContractArtifact
        );
      }

      this._status.contractsDeployed = true;
      console.log("AaveWrapper deployed at:", deployedContract.address.toString());
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
   * Check if full E2E testing is available (L1 connected and contracts deployed).
   */
  isFullE2EReady(): boolean {
    return (
      this.isReady() &&
      this._status.l1Connected &&
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
      `  Accounts Created: ${this._status.accountsCreated}`,
      `  Contracts Deployed: ${this._status.contractsDeployed}`,
    ];

    if (this._accounts.admin?.address) {
      lines.push(`  Admin: ${this._accounts.admin.address.toString()}`);
    }
    if (this._accounts.user?.address) {
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
 * Wait for Aztec node to be ready (3.0.0 SDK).
 *
 * @param nodeUrl - Node endpoint URL
 * @param timeoutMs - Maximum wait time
 * @returns true if node is ready, false otherwise
 */
export async function waitForPXE(
  nodeUrl: string,
  timeoutMs: number = 60_000
): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 2000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const { createAztecNodeClient, waitForNode } = await import("@aztec/aztec.js/node");
      const node = createAztecNodeClient(nodeUrl);
      await waitForNode(node);
      return true;
    } catch {
      // Node not ready yet
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
