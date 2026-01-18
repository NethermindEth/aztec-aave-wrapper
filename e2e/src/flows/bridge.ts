/**
 * Bridge Flow Orchestration Helpers
 *
 * This module provides helper functions for bridging USDC from L1 to L2:
 *
 * Flow: L1 USDC → TokenPortal deposit → L1→L2 message → L2 BridgedToken claim
 *
 * The bridge flow consists of:
 * 1. User approves TokenPortal for USDC on L1
 * 2. User calls TokenPortal.depositToAztecPrivate on L1
 * 3. Wait for L1→L2 message to be available
 * 4. Claim tokens on L2 via BridgedToken.mint_private (requires authorized minter)
 *
 * Note: In the test environment, the BridgedToken minter is configured during
 * setup to allow token minting for bridged deposits.
 */

import type { Address, Hex, PublicClient, WalletClient } from "viem";
import type { ChainClient } from "../setup";

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Parameters for bridging tokens from L1 to L2
 */
export interface BridgeToL2Params {
  /** Amount to bridge (in token decimals) */
  amount: bigint;
  /** Secret hash for claim authorization on L2 */
  secretHash: bigint;
  /** Recipient address on L2 */
  recipient: Hex;
}

/**
 * Result of the bridge operation
 */
export interface BridgeToL2Result {
  /** L1 transaction hash for the deposit */
  l1TxHash: Hex;
  /** L2 transaction hash for claiming (if claimed) */
  l2TxHash?: string;
  /** Whether the L2 claim succeeded */
  claimed: boolean;
  /** Amount bridged */
  amount: bigint;
}

/**
 * Configuration for the bridge helper
 */
export interface BridgeConfig {
  /** L1 USDC token address */
  usdcAddress: Address;
  /** L1 TokenPortal address */
  tokenPortalAddress: Address;
  /** L2 BridgedToken contract instance */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bridgedTokenContract: any;
  /** Wallet with minter privileges on BridgedToken (usually admin) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  minterWallet: any;
}

// =============================================================================
// ABI Definitions
// =============================================================================

/**
 * Minimal ERC20 ABI for approval and balance checks
 */
const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

/**
 * TokenPortal ABI for depositToAztecPrivate
 *
 * Note: This matches the ITokenPortal interface from the Solidity contracts.
 */
const TOKEN_PORTAL_ABI = [
  {
    type: "function",
    name: "depositToAztecPrivate",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "secretHashForRedeemingMintedNotes", type: "bytes32" },
      { name: "secretHashForL2MessageConsumption", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "nonpayable",
  },
] as const;

// =============================================================================
// Bridge Helper Functions
// =============================================================================

/**
 * Bridge USDC from L1 to L2 for E2E testing.
 *
 * This function orchestrates the complete bridge flow:
 * 1. Approves TokenPortal to spend USDC
 * 2. Calls depositToAztecPrivate on TokenPortal
 * 3. Waits for L1→L2 message propagation
 * 4. Claims tokens on L2 via BridgedToken.mint_private
 *
 * @param l1Client - L1 chain client with public and wallet clients
 * @param l1Wallet - L1 wallet for transactions
 * @param config - Bridge configuration with contract addresses
 * @param params - Bridge parameters (amount, secretHash, recipient)
 * @returns Result of the bridge operation
 *
 * @example
 * ```ts
 * const result = await bridgeToL2(
 *   l1Client,
 *   userWallet,
 *   {
 *     usdcAddress: '0x...',
 *     tokenPortalAddress: '0x...',
 *     bridgedTokenContract: bridgedToken,
 *     minterWallet: adminWallet,
 *   },
 *   {
 *     amount: 1_000_000n, // 1 USDC
 *     secretHash: computeSecretHash(secret).toBigInt(),
 *     recipient: userAddress.toString(),
 *   }
 * );
 *
 * expect(result.claimed).toBe(true);
 * ```
 */
export async function bridgeToL2(
  l1Client: ChainClient,
  l1Wallet: WalletClient,
  config: BridgeConfig,
  params: BridgeToL2Params
): Promise<BridgeToL2Result> {
  const { amount, secretHash, recipient } = params;
  const { usdcAddress, tokenPortalAddress, bridgedTokenContract, minterWallet } = config;

  // Step 1: Approve TokenPortal for USDC
  await approveTokenPortal(
    l1Wallet,
    l1Client.public,
    usdcAddress,
    tokenPortalAddress,
    amount
  );

  // Step 2: Call depositToAztecPrivate on TokenPortal
  const secretHashBytes32 = `0x${secretHash.toString(16).padStart(64, "0")}` as Hex;
  const l1TxHash = await depositToTokenPortal(
    l1Wallet,
    l1Client.public,
    tokenPortalAddress,
    amount,
    secretHashBytes32
  );

  // Step 3: Wait for L1→L2 message (in test environment, we simulate this)
  await waitForL1ToL2Message(l1Client.public);

  // Step 4: Claim tokens on L2 via BridgedToken.mint_private
  let l2TxHash: string | undefined;
  let claimed = false;

  try {
    const { AztecAddress } = await import("@aztec/aztec.js/addresses");
    const { Fr } = await import("@aztec/aztec.js/fields");

    const recipientAddress = AztecAddress.fromString(recipient);
    const randomness = Fr.random();

    // Get minter address for the transaction
    const minterAddress = minterWallet.getAddress?.() || minterWallet.address;

    // Call mint_private via the minter wallet
    const bridgedTokenWithMinter = bridgedTokenContract.withWallet(minterWallet);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = bridgedTokenWithMinter.methods as any;

    const mintTx = await methods
      .mint_private(recipientAddress, amount, randomness)
      .send({ from: minterAddress })
      .wait();

    l2TxHash = mintTx.txHash?.toString();
    claimed = true;
  } catch (error) {
    // L2 claim may fail in mock mode without real L1→L2 message
    console.warn(
      "L2 claim failed (expected in mock mode):",
      error instanceof Error ? error.message : error
    );
    claimed = false;
  }

  return {
    l1TxHash,
    l2TxHash,
    claimed,
    amount,
  };
}

/**
 * Approve TokenPortal to spend USDC tokens.
 *
 * @param wallet - L1 wallet client
 * @param publicClient - L1 public client for reading state
 * @param usdcAddress - USDC token address
 * @param tokenPortalAddress - TokenPortal address
 * @param amount - Amount to approve
 * @returns Transaction hash
 */
async function approveTokenPortal(
  wallet: WalletClient,
  publicClient: PublicClient,
  usdcAddress: Address,
  tokenPortalAddress: Address,
  amount: bigint
): Promise<Hex> {
  const account = wallet.account;
  if (!account) {
    throw new Error("Wallet account not available");
  }

  // Check current allowance
  const currentAllowance = (await publicClient.readContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account.address, tokenPortalAddress],
  })) as bigint;

  // Skip approval if already sufficient
  if (currentAllowance >= amount) {
    // Return a dummy hash for already approved case
    return `0x${"0".repeat(64)}` as Hex;
  }

  // Approve TokenPortal
  const txHash = await wallet.writeContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [tokenPortalAddress, amount],
    chain: wallet.chain,
    account,
  });

  // Wait for confirmation
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  return txHash;
}

/**
 * Call depositToAztecPrivate on TokenPortal.
 *
 * @param wallet - L1 wallet client
 * @param publicClient - L1 public client
 * @param tokenPortalAddress - TokenPortal address
 * @param amount - Amount to deposit
 * @param secretHash - Secret hash for L2 claim (bytes32)
 * @returns Transaction hash
 */
async function depositToTokenPortal(
  wallet: WalletClient,
  publicClient: PublicClient,
  tokenPortalAddress: Address,
  amount: bigint,
  secretHash: Hex
): Promise<Hex> {
  const account = wallet.account;
  if (!account) {
    throw new Error("Wallet account not available");
  }

  // Use the same secret hash for both parameters in the simplified test scenario
  const txHash = await wallet.writeContract({
    address: tokenPortalAddress,
    abi: TOKEN_PORTAL_ABI,
    functionName: "depositToAztecPrivate",
    args: [amount, secretHash, secretHash],
    chain: wallet.chain,
    account,
  });

  // Wait for confirmation
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  return txHash;
}

/**
 * Wait for L1→L2 message to be available.
 *
 * In a real environment, this would wait for the Aztec sequencer to include
 * the L1→L2 message. In the test environment, we just add a short delay
 * to simulate message propagation.
 *
 * @param _publicClient - L1 public client (unused in mock)
 */
async function waitForL1ToL2Message(_publicClient: PublicClient): Promise<void> {
  // In test environment, add a small delay to simulate message propagation
  // Real implementation would poll for message availability on L2
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check USDC balance on L1.
 *
 * @param publicClient - L1 public client
 * @param usdcAddress - USDC token address
 * @param account - Account to check balance for
 * @returns Balance in token decimals
 */
export async function getL1UsdcBalance(
  publicClient: PublicClient,
  usdcAddress: Address,
  account: Address
): Promise<bigint> {
  return (await publicClient.readContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account],
  })) as bigint;
}

/**
 * Check BridgedToken balance on L2.
 *
 * @param bridgedTokenContract - BridgedToken contract instance
 * @param owner - Owner address on L2
 * @returns Balance in token decimals
 */
export async function getL2TokenBalance(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bridgedTokenContract: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  owner: any
): Promise<bigint> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = bridgedTokenContract.methods as any;
    const balance = await methods.balance_of_private(owner).simulate();
    return BigInt(balance.toString());
  } catch (error) {
    console.warn("Failed to get L2 balance:", error instanceof Error ? error.message : error);
    return 0n;
  }
}

/**
 * Configure BridgedToken minter for testing.
 *
 * This sets the AaveWrapper contract as the authorized minter on BridgedToken.
 * Should be called during test setup after both contracts are deployed.
 *
 * @param bridgedTokenContract - BridgedToken contract instance
 * @param adminWallet - Admin wallet with set_minter privileges
 * @param minterAddress - Address to set as minter (AaveWrapper address)
 */
export async function configureBridgedTokenMinter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bridgedTokenContract: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminWallet: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  minterAddress: any
): Promise<void> {
  const adminAddress = adminWallet.getAddress?.() || adminWallet.address;
  const bridgedTokenWithAdmin = bridgedTokenContract.withWallet(adminWallet);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const methods = bridgedTokenWithAdmin.methods as any;

  await methods.set_minter(minterAddress).send({ from: adminAddress }).wait();
}

/**
 * Authorize a contract as a burner on BridgedToken.
 *
 * This allows the specified contract (like AaveWrapper) to burn tokens
 * from users' private balances during deposit operations.
 *
 * @param bridgedTokenContract - BridgedToken contract instance
 * @param adminWallet - Admin wallet with authorize_burner privileges
 * @param burnerAddress - Address to authorize as burner (AaveWrapper address)
 */
export async function authorizeBridgedTokenBurner(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bridgedTokenContract: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminWallet: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  burnerAddress: any
): Promise<void> {
  const adminAddress = adminWallet.getAddress?.() || adminWallet.address;
  const bridgedTokenWithAdmin = bridgedTokenContract.withWallet(adminWallet);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const methods = bridgedTokenWithAdmin.methods as any;

  await methods.authorize_burner(burnerAddress, true).send({ from: adminAddress }).wait();
}
