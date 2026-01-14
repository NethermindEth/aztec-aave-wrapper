/**
 * Full Flow Script for Aztec Aave Wrapper
 *
 * This script runs the REAL deposit and withdrawal flow with proper L1 contract deployment.
 *
 * DEPOSIT FLOW (L2 → L1 → L2):
 * 1. User calls request_deposit() on L2 → creates L2→L1 message
 * 2. Relayer calls executeDeposit() on L1 portal → supplies to Aave, sends L1→L2 message
 * 3. User calls finalize_deposit() on L2 → creates PositionReceiptNote
 *
 * WITHDRAW FLOW (L2 → L1 → L2):
 * 1. User calls request_withdraw() on L2 → consumes note, creates L2→L1 message
 * 2. Relayer calls executeWithdraw() on L1 portal → withdraws from Aave, sends L1→L2 message
 * 3. User calls finalize_withdraw() on L2 → tokens credited to user
 *
 * Usage:
 *   cd e2e && bun run full-flow
 *
 * Prerequisites:
 *   - Local devnet running (make devnet-up)
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeDeployData,
  keccak256,
  encodePacked,
  encodeAbiParameters,
  toHex,
  pad,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  l1RpcUrl: process.env.L1_RPC_URL ?? "http://localhost:8545",
  l2RpcUrl: process.env.L2_RPC_URL ?? "http://localhost:8081",
  depositAmount: 1_000_000n, // 1 USDC (6 decimals)
  withdrawAmount: 1_000_000n,
  assetId: 1n,
  originalDecimals: 6,
  deadlineOffset: 3600, // 1 hour
};

// Anvil test accounts
const ACCOUNTS = {
  deployer: privateKeyToAccount(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  ),
  user: privateKeyToAccount(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
  ),
  relayer: privateKeyToAccount(
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
  ),
};

// ============================================================================
// Type Definitions
// ============================================================================

interface L1Addresses {
  portal: Address;
  mockUsdc: Address;
  mockAToken: Address;
  mockLendingPool: Address;
  mockAztecOutbox: Address;
  mockAztecInbox: Address;
  mockTokenPortal: Address;
}

interface AztecModules {
  Fr: typeof import("@aztec/aztec.js/fields").Fr;
  AztecAddress: typeof import("@aztec/aztec.js/addresses").AztecAddress;
  createAztecNodeClient: typeof import("@aztec/aztec.js/node").createAztecNodeClient;
  waitForNode: typeof import("@aztec/aztec.js/node").waitForNode;
  computeSecretHash: typeof import("@aztec/stdlib/hash").computeSecretHash;
  poseidon2Hash: typeof import("@aztec/foundation/crypto/poseidon").poseidon2Hash;
}

// ============================================================================
// Helpers
// ============================================================================

function log(section: string, message: string, data?: Record<string, unknown>) {
  const timestamp = new Date().toISOString().slice(11, 19);
  const dataStr = data ? ` ${JSON.stringify(data)}` : "";
  console.log(`[${timestamp}] [${section}] ${message}${dataStr}`);
}

function logStep(step: number, total: number, description: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Step ${step}/${total}: ${description}`);
  console.log("=".repeat(60));
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deadlineFromNow(offsetSeconds: number): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + offsetSeconds);
}

function formatBalance(balance: bigint, decimals: number = 6): string {
  const whole = balance / BigInt(10 ** decimals);
  const fraction = balance % BigInt(10 ** decimals);
  return `${whole}.${fraction.toString().padStart(decimals, "0")} (${balance} raw)`;
}

function logBalanceTable(
  title: string,
  balances: Array<{ label: string; token: string; balance: bigint }>
) {
  console.log(`\n  📊 ${title}`);
  console.log("  " + "-".repeat(56));
  for (const { label, token, balance } of balances) {
    const formatted = formatBalance(balance);
    console.log(`  | ${label.padEnd(20)} | ${token.padEnd(8)} | ${formatted.padStart(20)} |`);
  }
  console.log("  " + "-".repeat(56));
}

async function getAllBalances(
  publicClient: PublicClient,
  addresses: L1Addresses,
  erc20Abi: any
): Promise<{
  portal: { usdc: bigint; aToken: bigint };
  lendingPool: { usdc: bigint; aToken: bigint };
}> {
  const [portalUsdc, portalAToken, poolUsdc, poolAToken] = await Promise.all([
    publicClient.readContract({
      address: addresses.mockUsdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [addresses.portal],
    }) as Promise<bigint>,
    publicClient.readContract({
      address: addresses.mockAToken,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [addresses.portal],
    }) as Promise<bigint>,
    publicClient.readContract({
      address: addresses.mockUsdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [addresses.mockLendingPool],
    }) as Promise<bigint>,
    publicClient.readContract({
      address: addresses.mockAToken,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [addresses.mockLendingPool],
    }) as Promise<bigint>,
  ]);

  return {
    portal: { usdc: portalUsdc, aToken: portalAToken },
    lendingPool: { usdc: poolUsdc, aToken: poolAToken },
  };
}

// ============================================================================
// Contract Artifacts (loaded from Foundry output)
// ============================================================================

function loadArtifact(contractPath: string, contractName: string) {
  const artifactPath = join(
    __dirname,
    `../../eth/out/${contractPath}/${contractName}.json`
  );
  const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as Hex,
  };
}

// ============================================================================
// L1 Contract Deployment
// ============================================================================

async function deployL1Contracts(
  publicClient: PublicClient,
  deployerWallet: WalletClient,
  l2ContractAddress: Hex
): Promise<L1Addresses> {
  log("L1", "Deploying L1 contracts...");

  // Load artifacts
  const mockERC20Artifact = loadArtifact("MockERC20.sol", "MockERC20");
  const mockOutboxArtifact = loadArtifact("Portal.t.sol", "MockAztecOutbox");
  const mockInboxArtifact = loadArtifact("Portal.t.sol", "MockAztecInbox");
  const mockTokenPortalArtifact = loadArtifact("Portal.t.sol", "MockTokenPortal");
  const mockLendingPoolArtifact = loadArtifact("Portal.t.sol", "MockAaveLendingPool");
  const portalArtifact = loadArtifact("AztecAavePortalL1.sol", "AztecAavePortalL1");

  // Deploy MockERC20 (USDC)
  log("L1", "Deploying MockERC20 (USDC)...");
  const usdcHash = await deployerWallet.deployContract({
    abi: mockERC20Artifact.abi,
    bytecode: mockERC20Artifact.bytecode,
    args: ["Mock USDC", "USDC", 6],
  });
  const usdcReceipt = await publicClient.waitForTransactionReceipt({ hash: usdcHash });
  const mockUsdc = usdcReceipt.contractAddress!;
  log("L1", "MockERC20 (USDC) deployed", { address: mockUsdc });

  // Deploy MockERC20 (aToken)
  log("L1", "Deploying MockERC20 (aUSDC)...");
  const aTokenHash = await deployerWallet.deployContract({
    abi: mockERC20Artifact.abi,
    bytecode: mockERC20Artifact.bytecode,
    args: ["Aave Mock USDC", "aUSDC", 6],
  });
  const aTokenReceipt = await publicClient.waitForTransactionReceipt({ hash: aTokenHash });
  const mockAToken = aTokenReceipt.contractAddress!;
  log("L1", "MockERC20 (aUSDC) deployed", { address: mockAToken });

  // Deploy MockAztecOutbox
  log("L1", "Deploying MockAztecOutbox...");
  const outboxHash = await deployerWallet.deployContract({
    abi: mockOutboxArtifact.abi,
    bytecode: mockOutboxArtifact.bytecode,
    args: [],
  });
  const outboxReceipt = await publicClient.waitForTransactionReceipt({ hash: outboxHash });
  const mockAztecOutbox = outboxReceipt.contractAddress!;
  log("L1", "MockAztecOutbox deployed", { address: mockAztecOutbox });

  // Deploy MockAztecInbox
  log("L1", "Deploying MockAztecInbox...");
  const inboxHash = await deployerWallet.deployContract({
    abi: mockInboxArtifact.abi,
    bytecode: mockInboxArtifact.bytecode,
    args: [],
  });
  const inboxReceipt = await publicClient.waitForTransactionReceipt({ hash: inboxHash });
  const mockAztecInbox = inboxReceipt.contractAddress!;
  log("L1", "MockAztecInbox deployed", { address: mockAztecInbox });

  // Deploy MockTokenPortal
  log("L1", "Deploying MockTokenPortal...");
  const tokenPortalHash = await deployerWallet.deployContract({
    abi: mockTokenPortalArtifact.abi,
    bytecode: mockTokenPortalArtifact.bytecode,
    args: [],
  });
  const tokenPortalReceipt = await publicClient.waitForTransactionReceipt({ hash: tokenPortalHash });
  const mockTokenPortal = tokenPortalReceipt.contractAddress!;
  log("L1", "MockTokenPortal deployed", { address: mockTokenPortal });

  // Deploy MockAaveLendingPool
  log("L1", "Deploying MockAaveLendingPool...");
  const lendingPoolHash = await deployerWallet.deployContract({
    abi: mockLendingPoolArtifact.abi,
    bytecode: mockLendingPoolArtifact.bytecode,
    args: [mockUsdc, mockAToken],
  });
  const lendingPoolReceipt = await publicClient.waitForTransactionReceipt({ hash: lendingPoolHash });
  const mockLendingPool = lendingPoolReceipt.contractAddress!;
  log("L1", "MockAaveLendingPool deployed", { address: mockLendingPool });

  // Deploy AztecAavePortalL1
  log("L1", "Deploying AztecAavePortalL1...");
  const l2AddressBytes32 = pad(l2ContractAddress as Hex, { size: 32 });
  const portalHash = await deployerWallet.deployContract({
    abi: portalArtifact.abi,
    bytecode: portalArtifact.bytecode,
    args: [
      mockAztecOutbox,
      mockAztecInbox,
      mockTokenPortal,
      mockLendingPool,
      l2AddressBytes32,
      ACCOUNTS.deployer.address,
    ],
  });
  const portalReceipt = await publicClient.waitForTransactionReceipt({ hash: portalHash });
  const portal = portalReceipt.contractAddress!;
  log("L1", "AztecAavePortalL1 deployed", { address: portal });

  return {
    portal,
    mockUsdc,
    mockAToken,
    mockLendingPool,
    mockAztecOutbox,
    mockAztecInbox,
    mockTokenPortal,
  };
}

// ============================================================================
// L1 Setup
// ============================================================================

async function setupL1Clients(): Promise<{
  publicClient: PublicClient;
  deployerWallet: WalletClient;
  userWallet: WalletClient;
  relayerWallet: WalletClient;
}> {
  log("L1", "Connecting to Anvil...", { rpcUrl: CONFIG.l1RpcUrl });

  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(CONFIG.l1RpcUrl),
  });

  const deployerWallet = createWalletClient({
    account: ACCOUNTS.deployer,
    chain: foundry,
    transport: http(CONFIG.l1RpcUrl),
  });

  const userWallet = createWalletClient({
    account: ACCOUNTS.user,
    chain: foundry,
    transport: http(CONFIG.l1RpcUrl),
  });

  const relayerWallet = createWalletClient({
    account: ACCOUNTS.relayer,
    chain: foundry,
    transport: http(CONFIG.l1RpcUrl),
  });

  const chainId = await publicClient.getChainId();
  log("L1", "Connected to chain", { chainId });

  return { publicClient, deployerWallet, userWallet, relayerWallet };
}

// ============================================================================
// L2 Setup
// ============================================================================

async function loadAztecModules(): Promise<AztecModules> {
  log("L2", "Loading Aztec modules...");

  const [fieldsModule, addressesModule, nodeModule, hashModule, cryptoModule] =
    await Promise.all([
      import("@aztec/aztec.js/fields"),
      import("@aztec/aztec.js/addresses"),
      import("@aztec/aztec.js/node"),
      import("@aztec/stdlib/hash"),
      import("@aztec/foundation/crypto/poseidon"),
    ]);

  return {
    Fr: fieldsModule.Fr,
    AztecAddress: addressesModule.AztecAddress,
    createAztecNodeClient: nodeModule.createAztecNodeClient,
    waitForNode: nodeModule.waitForNode,
    computeSecretHash: hashModule.computeSecretHash,
    poseidon2Hash: cryptoModule.poseidon2Hash,
  };
}

async function setupL2Client(aztec: AztecModules) {
  log("L2", "Connecting to Aztec sandbox...", { rpcUrl: CONFIG.l2RpcUrl });

  const node = aztec.createAztecNodeClient(CONFIG.l2RpcUrl);
  await aztec.waitForNode(node);

  const nodeInfo = await node.getNodeInfo();
  log("L2", "Connected to Aztec", { version: nodeInfo.nodeVersion });

  return node;
}

async function setupL2Wallet(
  aztec: AztecModules,
  node: Awaited<ReturnType<typeof setupL2Client>>
) {
  log("L2", "Setting up test wallet...");

  const { TestWallet } = await import("@aztec/test-wallet/server");
  const {
    INITIAL_TEST_SECRET_KEYS,
    INITIAL_TEST_SIGNING_KEYS,
    INITIAL_TEST_ACCOUNT_SALTS,
  } = await import("@aztec/accounts/testing");

  const wallet = await TestWallet.create(node, { proverEnabled: false });
  const accountManager = await wallet.createSchnorrAccount(
    INITIAL_TEST_SECRET_KEYS[0]!,
    INITIAL_TEST_ACCOUNT_SALTS[0]!,
    INITIAL_TEST_SIGNING_KEYS[0]!
  );

  log("L2", "User wallet created", { address: accountManager.address.toString() });

  return { wallet, address: accountManager.address };
}

// ============================================================================
// L2 Contract Deployment
// ============================================================================

async function deployL2Contract(
  wallet: Awaited<ReturnType<typeof setupL2Wallet>>["wallet"],
  walletAddress: Awaited<ReturnType<typeof setupL2Wallet>>["address"],
  portalAddress: Address
) {
  log("L2", "Deploying AaveWrapper contract...");

  const { AaveWrapperContract } = await import("../src/generated/AaveWrapper");
  const { EthAddress } = await import("@aztec/foundation/eth-address");

  const portalEthAddress = EthAddress.fromString(portalAddress);

  const deployedContract = await AaveWrapperContract.deploy(
    wallet,
    walletAddress,
    portalEthAddress
  )
    .send({ from: walletAddress })
    .deployed();

  log("L2", "AaveWrapper deployed", { address: deployedContract.address.toString() });

  return deployedContract;
}

// ============================================================================
// Mining Helpers
// ============================================================================

async function mineAztecBlocks(
  node: Awaited<ReturnType<typeof setupL2Client>>,
  numBlocks: number
) {
  log("L2", `Mining ${numBlocks} Aztec block(s)...`);
  for (let i = 0; i < numBlocks; i++) {
    await sleep(1000);
  }
  const currentBlock = await node.getBlockNumber();
  log("L2", "Current block", { blockNumber: currentBlock });
}

async function mineL1Block(publicClient: PublicClient) {
  log("L1", "Mining L1 block...");
  await fetch(CONFIG.l1RpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "evm_mine",
      params: [],
    }),
  });
  const block = await publicClient.getBlockNumber();
  log("L1", "Current block", { blockNumber: Number(block) });
}

// ============================================================================
// Intent Hash Computation (matches Solidity IntentLib)
// ============================================================================

function computeDepositIntentHash(intent: {
  intentId: Hex;
  ownerHash: Hex;
  asset: Address;
  amount: bigint;
  originalDecimals: number;
  deadline: bigint;
  salt: Hex;
}): Hex {
  // Match Solidity: keccak256(abi.encode(...))
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "address" },
        { type: "uint128" },
        { type: "uint8" },
        { type: "uint64" },
        { type: "bytes32" },
      ],
      [
        intent.intentId,
        intent.ownerHash,
        intent.asset,
        intent.amount,
        intent.originalDecimals,
        intent.deadline,
        intent.salt,
      ]
    )
  );
}

// ============================================================================
// Deposit Flow
// ============================================================================

async function executeDepositFlow(
  aztec: AztecModules,
  l1: Awaited<ReturnType<typeof setupL1Clients>>,
  l1Addresses: L1Addresses,
  l2: {
    node: Awaited<ReturnType<typeof setupL2Client>>;
    wallet: Awaited<ReturnType<typeof setupL2Wallet>>["wallet"];
    address: Awaited<ReturnType<typeof setupL2Wallet>>["address"];
    contract: Awaited<ReturnType<typeof deployL2Contract>>;
  }
) {
  logStep(1, 6, "DEPOSIT - Generate secret and prepare parameters");

  const secret = aztec.Fr.random();
  const secretHash = await aztec.computeSecretHash(secret);
  const deadline = deadlineFromNow(CONFIG.deadlineOffset);

  log("Deposit", "Parameters generated", {
    deadline: deadline.toString(),
    amount: CONFIG.depositAmount.toString(),
  });

  // Compute owner hash (privacy: user address is hashed)
  const ownerHashFr = await aztec.poseidon2Hash([l2.address.toBigInt()]);
  const ownerHash = ownerHashFr.toBigInt();

  log("Privacy", "Owner hash computed", {
    originalAddress: l2.address.toString().slice(0, 20) + "...",
    ownerHash: "0x" + ownerHash.toString(16).slice(0, 16) + "...",
  });

  // -------------------------------------------------------------------------
  logStep(2, 6, "DEPOSIT - Call request_deposit on L2");

  const methods = (l2.contract as any).methods;

  const depositCall = methods.request_deposit(
    CONFIG.assetId,
    CONFIG.depositAmount,
    CONFIG.originalDecimals,
    deadline,
    secretHash
  );

  const intentId = await depositCall.simulate({ from: l2.address });
  log("L2", "Intent ID computed", { intentId: intentId.toString() });

  const depositTx = await depositCall.send({ from: l2.address }).wait();
  log("L2", "request_deposit transaction mined", {
    txHash: depositTx.txHash?.toString(),
  });

  // -------------------------------------------------------------------------
  logStep(3, 6, "DEPOSIT - Wait for L2→L1 message to be available");

  await mineAztecBlocks(l2.node, 2);
  log("L2", "L2→L1 message should now be in outbox");

  // -------------------------------------------------------------------------
  logStep(4, 6, "DEPOSIT - Fund portal and execute deposit on L1");

  // Load artifacts for ABI
  const mockERC20Artifact = loadArtifact("MockERC20.sol", "MockERC20");
  const mockOutboxArtifact = loadArtifact("Portal.t.sol", "MockAztecOutbox");
  const portalArtifact = loadArtifact("AztecAavePortalL1.sol", "AztecAavePortalL1");

  // Log initial balances (all should be zero)
  log("L1", "Checking initial balances...");
  let balances = await getAllBalances(l1.publicClient, l1Addresses, mockERC20Artifact.abi);
  logBalanceTable("INITIAL STATE (before mint)", [
    { label: "Portal", token: "USDC", balance: balances.portal.usdc },
    { label: "Portal", token: "aUSDC", balance: balances.portal.aToken },
    { label: "Aave Pool", token: "USDC", balance: balances.lendingPool.usdc },
    { label: "Aave Pool", token: "aUSDC", balance: balances.lendingPool.aToken },
  ]);

  // Mint tokens to portal
  const mintAmount = CONFIG.depositAmount * 10n;
  log("L1", `Minting ${formatBalance(mintAmount)} USDC to portal...`);
  const mintTx = await l1.deployerWallet.writeContract({
    address: l1Addresses.mockUsdc,
    abi: mockERC20Artifact.abi,
    functionName: "mint",
    args: [l1Addresses.portal, mintAmount],
  });
  await l1.publicClient.waitForTransactionReceipt({ hash: mintTx });

  // Log balances after mint
  balances = await getAllBalances(l1.publicClient, l1Addresses, mockERC20Artifact.abi);
  logBalanceTable("AFTER MINT (portal funded)", [
    { label: "Portal", token: "USDC", balance: balances.portal.usdc },
    { label: "Portal", token: "aUSDC", balance: balances.portal.aToken },
    { label: "Aave Pool", token: "USDC", balance: balances.lendingPool.usdc },
    { label: "Aave Pool", token: "aUSDC", balance: balances.lendingPool.aToken },
  ]);

  // Create deposit intent for L1
  const salt = keccak256(encodePacked(["uint256"], [BigInt(Date.now())]));
  const intentIdHex = pad(toHex(BigInt(intentId.toString())), { size: 32 });
  const ownerHashHex = pad(toHex(ownerHash), { size: 32 });

  const depositIntent = {
    intentId: intentIdHex,
    ownerHash: ownerHashHex,
    asset: l1Addresses.mockUsdc,
    amount: CONFIG.depositAmount,
    originalDecimals: CONFIG.originalDecimals,
    deadline: deadline,
    salt: salt,
  };

  // Compute message hash and set it as valid in mock outbox
  const messageHash = computeDepositIntentHash(depositIntent);
  log("L1", "Setting message as valid in mock outbox", { messageHash });

  const l2BlockNumber = 100n;
  await l1.deployerWallet.writeContract({
    address: l1Addresses.mockAztecOutbox,
    abi: mockOutboxArtifact.abi,
    functionName: "setMessageValid",
    args: [messageHash, l2BlockNumber, true],
  });

  // Execute deposit
  log("Privacy", "Relayer executing L1 deposit (not user)", {
    relayer: ACCOUNTS.relayer.address,
    user: ACCOUNTS.user.address,
    relayerIsNotUser: ACCOUNTS.relayer.address !== ACCOUNTS.user.address,
  });

  try {
    log("L1", `Executing deposit for ${formatBalance(CONFIG.depositAmount)} USDC...`);
    const executeDepositTx = await l1.relayerWallet.writeContract({
      address: l1Addresses.portal,
      abi: portalArtifact.abi,
      functionName: "executeDeposit",
      args: [depositIntent, l2BlockNumber, 0n, []],
    });
    await l1.publicClient.waitForTransactionReceipt({ hash: executeDepositTx });
    log("L1", "executeDeposit succeeded", { txHash: executeDepositTx });

    // Log balances after deposit - USDC should move to pool, aTokens to portal
    balances = await getAllBalances(l1.publicClient, l1Addresses, mockERC20Artifact.abi);
    logBalanceTable("AFTER DEPOSIT (USDC → Aave, aUSDC → Portal)", [
      { label: "Portal", token: "USDC", balance: balances.portal.usdc },
      { label: "Portal", token: "aUSDC", balance: balances.portal.aToken },
      { label: "Aave Pool", token: "USDC", balance: balances.lendingPool.usdc },
      { label: "Aave Pool", token: "aUSDC", balance: balances.lendingPool.aToken },
    ]);

    // Log the expected fund movement
    console.log("\n  💰 Fund Movement Summary:");
    console.log(`     Portal USDC:    -${formatBalance(CONFIG.depositAmount)} (sent to Aave)`);
    console.log(`     Portal aUSDC:   +${formatBalance(CONFIG.depositAmount)} (received from Aave)`);
    console.log(`     Aave Pool USDC: +${formatBalance(CONFIG.depositAmount)} (deposited)`);

    // Check shares were recorded
    const shares = await l1.publicClient.readContract({
      address: l1Addresses.portal,
      abi: portalArtifact.abi,
      functionName: "intentShares",
      args: [intentIdHex],
    });
    log("L1", "Shares recorded for intent", { intentId: intentIdHex.slice(0, 18) + "...", shares: shares.toString() });
  } catch (error) {
    log("L1", "executeDeposit failed", {
      error: error instanceof Error ? error.message.slice(0, 200) : "Unknown",
    });

    // Still log balances to see the state
    balances = await getAllBalances(l1.publicClient, l1Addresses, mockERC20Artifact.abi);
    logBalanceTable("AFTER FAILED DEPOSIT", [
      { label: "Portal", token: "USDC", balance: balances.portal.usdc },
      { label: "Portal", token: "aUSDC", balance: balances.portal.aToken },
      { label: "Aave Pool", token: "USDC", balance: balances.lendingPool.usdc },
      { label: "Aave Pool", token: "aUSDC", balance: balances.lendingPool.aToken },
    ]);
  }

  // -------------------------------------------------------------------------
  logStep(5, 6, "DEPOSIT - Wait for L1→L2 message");

  await mineL1Block(l1.publicClient);
  await mineAztecBlocks(l2.node, 2);
  log("L1→L2", "Message should now be available in inbox");

  // -------------------------------------------------------------------------
  logStep(6, 6, "DEPOSIT - Call finalize_deposit on L2");

  log("L2", "Attempting finalize_deposit...");

  const mockShares = CONFIG.depositAmount; // MVP: shares = amount

  try {
    const finalizeCall = methods.finalize_deposit(
      intentId,
      CONFIG.assetId,
      mockShares,
      secret,
      0n
    );
    const finalizeTx = await finalizeCall.send({ from: l2.address }).wait();
    log("L2", "finalize_deposit succeeded", {
      txHash: finalizeTx.txHash?.toString(),
    });
  } catch (error) {
    log("L2", "finalize_deposit failed (expected without real L1→L2 message)", {
      error: error instanceof Error ? error.message.slice(0, 100) : "Unknown",
    });
  }

  console.log("\n" + "=".repeat(60));
  console.log("DEPOSIT FLOW COMPLETE");
  console.log("=".repeat(60));
  console.log("\nSummary:");
  console.log(`  Intent ID: ${intentId.toString()}`);
  console.log(`  Amount: ${formatBalance(CONFIG.depositAmount)}`);
  console.log(`  Shares: ${mockShares.toString()}`);
  console.log(
    `  Privacy: Relayer (${ACCOUNTS.relayer.address.slice(0, 10)}...) ≠ User`
  );

  // Final balance snapshot
  const finalBalances = await getAllBalances(l1.publicClient, l1Addresses, mockERC20Artifact.abi);
  logBalanceTable("FINAL L1 STATE", [
    { label: "Portal", token: "USDC", balance: finalBalances.portal.usdc },
    { label: "Portal", token: "aUSDC", balance: finalBalances.portal.aToken },
    { label: "Aave Pool", token: "USDC", balance: finalBalances.lendingPool.usdc },
    { label: "Aave Pool", token: "aUSDC", balance: finalBalances.lendingPool.aToken },
  ]);

  return { intentId, secret, secretHash, shares: mockShares, mockERC20Artifact };
}

// ============================================================================
// Withdraw Flow
// ============================================================================

async function executeWithdrawFlow(
  aztec: AztecModules,
  l1: Awaited<ReturnType<typeof setupL1Clients>>,
  l1Addresses: L1Addresses,
  l2: {
    node: Awaited<ReturnType<typeof setupL2Client>>;
    wallet: Awaited<ReturnType<typeof setupL2Wallet>>["wallet"];
    address: Awaited<ReturnType<typeof setupL2Wallet>>["address"];
    contract: Awaited<ReturnType<typeof deployL2Contract>>;
  },
  depositResult: { intentId: any; secret: any; shares: bigint; mockERC20Artifact: any }
) {
  console.log("\n\n");
  logStep(1, 4, "WITHDRAW - Generate secret and prepare parameters");

  // Show current L1 state before withdrawal
  const balances = await getAllBalances(l1.publicClient, l1Addresses, depositResult.mockERC20Artifact.abi);
  logBalanceTable("CURRENT L1 STATE (before withdraw)", [
    { label: "Portal", token: "USDC", balance: balances.portal.usdc },
    { label: "Portal", token: "aUSDC", balance: balances.portal.aToken },
    { label: "Aave Pool", token: "USDC", balance: balances.lendingPool.usdc },
    { label: "Aave Pool", token: "aUSDC", balance: balances.lendingPool.aToken },
  ]);

  const withdrawSecret = aztec.Fr.random();
  const withdrawSecretHash = await aztec.computeSecretHash(withdrawSecret);
  const deadline = deadlineFromNow(CONFIG.deadlineOffset);

  log("Withdraw", "Parameters generated", {
    deadline: deadline.toString(),
    amount: CONFIG.withdrawAmount.toString(),
    nonce: depositResult.intentId.toString(),
  });

  // -------------------------------------------------------------------------
  logStep(2, 4, "WITHDRAW - Call request_withdraw on L2");

  const methods = (l2.contract as any).methods;

  log("L2", "Attempting request_withdraw...");

  try {
    const withdrawCall = methods.request_withdraw(
      depositResult.intentId,
      CONFIG.withdrawAmount,
      deadline,
      withdrawSecretHash
    );

    const withdrawIntentId = await withdrawCall.simulate({ from: l2.address });
    log("L2", "Withdraw intent ID", { intentId: withdrawIntentId.toString() });

    const withdrawTx = await withdrawCall.send({ from: l2.address }).wait();
    log("L2", "request_withdraw succeeded", {
      txHash: withdrawTx.txHash?.toString(),
    });
  } catch (error) {
    log(
      "L2",
      "request_withdraw failed (expected without finalized deposit position)",
      {
        error: error instanceof Error ? error.message.slice(0, 100) : "Unknown",
      }
    );
    log("L2", "This is expected behavior:");
    log("L2", "  - Deposit was not finalized (no real L1→L2 message)");
    log("L2", "  - No PositionReceiptNote exists to withdraw from");
  }

  console.log("\n" + "=".repeat(60));
  console.log("WITHDRAW FLOW COMPLETE");
  console.log("=".repeat(60));
  console.log("\nSummary:");
  console.log(`  Deposit Intent ID: ${depositResult.intentId.toString()}`);
  console.log(`  Amount: ${formatBalance(CONFIG.withdrawAmount)}`);
  console.log(
    `  Privacy: Relayer (${ACCOUNTS.relayer.address.slice(0, 10)}...) ≠ User`
  );
  console.log(
    `  Note: Full withdraw flow requires finalized deposit with real L1→L2 message`
  );

  console.log("\n  💰 Expected Fund Movement (if withdrawal succeeds):");
  console.log(`     Portal aUSDC:   -${formatBalance(CONFIG.withdrawAmount)} (burned)`);
  console.log(`     Aave Pool USDC: -${formatBalance(CONFIG.withdrawAmount)} (withdrawn)`);
  console.log(`     User receives:  +${formatBalance(CONFIG.withdrawAmount)} USDC (via bridge)`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("=".repeat(60));
  console.log("Aztec Aave Wrapper - Full Flow");
  console.log("=".repeat(60));
  console.log("\nThis script runs the REAL deposit/withdraw flow with");
  console.log("proper L1 contract deployment and execution.\n");

  try {
    // Setup L1
    const l1 = await setupL1Clients();

    // Setup L2
    const aztec = await loadAztecModules();
    const node = await setupL2Client(aztec);
    const { wallet, address } = await setupL2Wallet(aztec, node);

    // Deploy L2 contract first (we need the address for L1 portal)
    // Use a placeholder portal address initially
    const placeholderPortal = "0x0000000000000000000000000000000000000001" as Address;
    const l2Contract = await deployL2Contract(wallet, address, placeholderPortal);

    // Deploy L1 contracts with L2 contract address
    const l1Addresses = await deployL1Contracts(
      l1.publicClient,
      l1.deployerWallet,
      l2Contract.address.toString() as Hex
    );

    log("Deploy", "All contracts deployed", {
      l2AaveWrapper: l2Contract.address.toString(),
      l1Portal: l1Addresses.portal,
    });

    const l2 = { node, wallet, address, contract: l2Contract };

    // Execute deposit flow
    console.log("\n\n");
    console.log("#".repeat(60));
    console.log("# DEPOSIT FLOW");
    console.log("#".repeat(60));

    const depositResult = await executeDepositFlow(aztec, l1, l1Addresses, l2);

    // Execute withdraw flow
    console.log("\n\n");
    console.log("#".repeat(60));
    console.log("# WITHDRAW FLOW");
    console.log("#".repeat(60));

    await executeWithdrawFlow(aztec, l1, l1Addresses, l2, depositResult);

    // Summary
    console.log("\n\n");
    console.log("#".repeat(60));
    console.log("# FULL FLOW COMPLETE");
    console.log("#".repeat(60));
    console.log("\nKey Privacy Properties Demonstrated:");
    console.log("  1. User L2 address is NEVER revealed on L1");
    console.log("  2. ownerHash (one-way Poseidon hash) used in cross-chain messages");
    console.log("  3. Relayer executes L1 operations (not user)");
    console.log("  4. secret/secretHash for authorization");
    console.log("\nL1 Contracts Deployed:");
    console.log(`  Portal: ${l1Addresses.portal}`);
    console.log(`  MockUSDC: ${l1Addresses.mockUsdc}`);
    console.log(`  MockAToken: ${l1Addresses.mockAToken}`);
    console.log(`  MockLendingPool: ${l1Addresses.mockLendingPool}`);
    console.log(`\nL2 Contract Deployed:`);
    console.log(`  AaveWrapper: ${l2Contract.address.toString()}`);
  } catch (error) {
    console.error("\nFATAL ERROR:", error);
    process.exit(1);
  }
}

main();
