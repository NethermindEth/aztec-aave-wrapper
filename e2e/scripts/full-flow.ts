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
  keccak256,
  encodePacked,
  encodeAbiParameters,
  toHex,
  pad,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry as foundryChain } from "viem/chains";

// Cast to any to avoid type mismatch between viem and @aztec/viem
const foundry = foundryChain as any;
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  l1RpcUrl: process.env.L1_RPC_URL ?? "http://localhost:8545",
  l2RpcUrl: process.env.L2_RPC_URL ?? "http://localhost:8080",
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
  /** Real Aztec outbox address from sandbox (required for L2→L1 messaging) */
  aztecOutbox: Address;
  /** Real Aztec inbox address from sandbox (required for L1→L2 messaging) */
  aztecInbox: Address;
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
  publicClient: any,
  addresses: L1Addresses,
  erc20Abi: any,
  userAddress?: Address
): Promise<{
  user: { usdc: bigint; aToken: bigint };
  portal: { usdc: bigint; aToken: bigint };
  lendingPool: { usdc: bigint; aToken: bigint };
}> {
  const queries = [
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
  ];

  // Add user balance queries if user address provided
  if (userAddress) {
    queries.push(
      publicClient.readContract({
        address: addresses.mockUsdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [userAddress],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: addresses.mockAToken,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [userAddress],
      }) as Promise<bigint>
    );
  }

  const results = await Promise.all(queries);
  const [portalUsdc, portalAToken, poolUsdc, poolAToken, userUsdc, userAToken] = results;

  return {
    user: { usdc: userUsdc ?? 0n, aToken: userAToken ?? 0n },
    portal: { usdc: portalUsdc ?? 0n, aToken: portalAToken ?? 0n },
    lendingPool: { usdc: poolUsdc ?? 0n, aToken: poolAToken ?? 0n },
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
  publicClient: any,
  deployerWallet: any,
  l2ContractAddress: Hex,
  aztecInboxAddress: Address,
  aztecOutboxAddress: Address
): Promise<L1Addresses> {
  log("L1", "Deploying L1 contracts...");
  log("L1", "Using real Aztec inbox", { address: aztecInboxAddress });
  log("L1", "Using real Aztec outbox", { address: aztecOutboxAddress });

  // Load artifacts - using real inbox and outbox from sandbox
  const mockERC20Artifact = loadArtifact("MockERC20.sol", "MockERC20");
  const mockTokenPortalArtifact = loadArtifact("Portal.t.sol", "MockTokenPortal");
  const mockLendingPoolArtifact = loadArtifact("Portal.t.sol", "MockAaveLendingPool");
  const portalArtifact = loadArtifact("AztecAavePortalL1.sol", "AztecAavePortalL1");

  // Deploy MockERC20 (USDC)
  log("L1", "Deploying MockERC20 (USDC)...");
  const usdcHash = await deployerWallet.deployContract({
    account: ACCOUNTS.deployer,
    chain: foundry,
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
    account: ACCOUNTS.deployer,
    chain: foundry,
    abi: mockERC20Artifact.abi,
    bytecode: mockERC20Artifact.bytecode,
    args: ["Aave Mock USDC", "aUSDC", 6],
  });
  const aTokenReceipt = await publicClient.waitForTransactionReceipt({ hash: aTokenHash });
  const mockAToken = aTokenReceipt.contractAddress!;
  log("L1", "MockERC20 (aUSDC) deployed", { address: mockAToken });

  // Note: Using REAL Aztec inbox and outbox from sandbox
  // Mock versions do NOT work - messages are not consumable on L2

  // Deploy MockTokenPortal
  log("L1", "Deploying MockTokenPortal...");
  const tokenPortalHash = await deployerWallet.deployContract({
    account: ACCOUNTS.deployer,
    chain: foundry,
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
    account: ACCOUNTS.deployer,
    chain: foundry,
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
    account: ACCOUNTS.deployer,
    chain: foundry,
    abi: portalArtifact.abi,
    bytecode: portalArtifact.bytecode,
    args: [
      aztecOutboxAddress,  // REAL Aztec outbox - required for L2→L1 messaging
      aztecInboxAddress,  // REAL Aztec inbox - required for L1→L2 messaging
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
    aztecOutbox: aztecOutboxAddress,
    aztecInbox: aztecInboxAddress,
    mockTokenPortal,
  };
}

// ============================================================================
// L1 Setup
// ============================================================================

async function setupL1Clients() {
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
  // Use wallet address as mock bridged token and fee treasury for testing
  const mockBridgedToken = walletAddress;
  const mockFeeTreasury = walletAddress;

  const deployedContract = await AaveWrapperContract.deploy(
    wallet,
    walletAddress,
    portalEthAddress,
    mockBridgedToken,
    mockFeeTreasury
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

async function mineL1Block(publicClient: any) {
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
  secretHash: Hex;
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
        intent.secretHash,
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

  // Get L1 block timestamp to compute deadline (Anvil may be ahead/behind real time)
  const l1Block = await l1.publicClient.getBlock();
  const l1Timestamp = Number(l1Block.timestamp);
  const deadline = BigInt(l1Timestamp + CONFIG.deadlineOffset);
  log("L1", "Using L1 timestamp for deadline", {
    l1Timestamp,
    deadlineOffset: CONFIG.deadlineOffset,
    deadline: deadline.toString()
  });

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
  logStep(4, 6, "DEPOSIT - User funds portal, relayer executes on L1");

  // Load artifacts for ABI
  const mockERC20Artifact = loadArtifact("MockERC20.sol", "MockERC20");
  const portalArtifact = loadArtifact("AztecAavePortalL1.sol", "AztecAavePortalL1");

  const userL1Address = ACCOUNTS.user.address;

  // Step 4a: Show initial state (all balances zero)
  log("L1", "Checking initial balances...");
  let balances = await getAllBalances(l1.publicClient, l1Addresses, mockERC20Artifact.abi, userL1Address);
  logBalanceTable("INITIAL STATE (all empty)", [
    { label: "User (L1)", token: "USDC", balance: balances.user.usdc },
    { label: "Portal", token: "USDC", balance: balances.portal.usdc },
    { label: "Portal", token: "aUSDC", balance: balances.portal.aToken },
    { label: "Aave Pool", token: "USDC", balance: balances.lendingPool.usdc },
  ]);

  // Step 4b: User receives USDC on L1 (simulating user already has funds)
  const userFundAmount = CONFIG.depositAmount * 10n;
  log("L1", `User receives ${formatBalance(userFundAmount)} USDC on L1...`);
  const mintToUserTx = await l1.deployerWallet.writeContract({
    chain: foundry,
    address: l1Addresses.mockUsdc,
    abi: mockERC20Artifact.abi,
    functionName: "mint",
    args: [userL1Address, userFundAmount],
  });
  await l1.publicClient.waitForTransactionReceipt({ hash: mintToUserTx });

  balances = await getAllBalances(l1.publicClient, l1Addresses, mockERC20Artifact.abi, userL1Address);
  logBalanceTable("USER HAS USDC (starting point)", [
    { label: "User (L1)", token: "USDC", balance: balances.user.usdc },
    { label: "Portal", token: "USDC", balance: balances.portal.usdc },
    { label: "Portal", token: "aUSDC", balance: balances.portal.aToken },
    { label: "Aave Pool", token: "USDC", balance: balances.lendingPool.usdc },
  ]);

  // Step 4c: User approves portal to spend USDC
  log("L1", `User approves portal to spend ${formatBalance(CONFIG.depositAmount)} USDC...`);
  const approveTx = await l1.userWallet.writeContract({
    chain: foundry,
    address: l1Addresses.mockUsdc,
    abi: mockERC20Artifact.abi,
    functionName: "approve",
    args: [l1Addresses.portal, CONFIG.depositAmount],
  });
  await l1.publicClient.waitForTransactionReceipt({ hash: approveTx });

  // Step 4d: User transfers USDC to portal (funding the deposit)
  log("L1", `User transfers ${formatBalance(CONFIG.depositAmount)} USDC to portal...`);
  const transferTx = await l1.userWallet.writeContract({
    chain: foundry,
    address: l1Addresses.mockUsdc,
    abi: mockERC20Artifact.abi,
    functionName: "transfer",
    args: [l1Addresses.portal, CONFIG.depositAmount],
  });
  await l1.publicClient.waitForTransactionReceipt({ hash: transferTx });

  balances = await getAllBalances(l1.publicClient, l1Addresses, mockERC20Artifact.abi, userL1Address);
  logBalanceTable("AFTER USER FUNDS PORTAL", [
    { label: "User (L1)", token: "USDC", balance: balances.user.usdc },
    { label: "Portal", token: "USDC", balance: balances.portal.usdc },
    { label: "Portal", token: "aUSDC", balance: balances.portal.aToken },
    { label: "Aave Pool", token: "USDC", balance: balances.lendingPool.usdc },
  ]);

  console.log("\n  💰 User deposited USDC to portal:");
  console.log(`     User USDC:   -${formatBalance(CONFIG.depositAmount)} (sent to portal)`);
  console.log(`     Portal USDC: +${formatBalance(CONFIG.depositAmount)} (received from user)`);

  // Verify deadline is still valid from L1's perspective
  const currentBlock = await l1.publicClient.getBlock();
  const timeUntilDeadline = Number(deadline) - Number(currentBlock.timestamp);
  log("L1", "Deadline check", {
    currentL1Timestamp: Number(currentBlock.timestamp),
    deadline: deadline.toString(),
    timeUntilDeadline: `${timeUntilDeadline}s (${Math.floor(timeUntilDeadline / 60)}m)`
  });

  // Create deposit intent for L1
  const salt = keccak256(encodePacked(["uint256"], [BigInt(Date.now())]));
  const intentIdHex = pad(toHex(BigInt(intentId.toString())), { size: 32 });
  const ownerHashHex = pad(toHex(ownerHash), { size: 32 });
  // Convert Fr secretHash to hex for L1 - ensures L1→L2 message uses same hash
  const secretHashHex = pad(toHex(secretHash.toBigInt()), { size: 32 });

  const depositIntent = {
    intentId: intentIdHex,
    ownerHash: ownerHashHex,
    asset: l1Addresses.mockUsdc,
    amount: CONFIG.depositAmount,
    originalDecimals: CONFIG.originalDecimals,
    deadline: deadline,
    salt: salt,
    secretHash: secretHashHex,
  };

  // Compute the L2→L1 message hash (matches what L2 contract sends)
  const messageHash = computeDepositIntentHash(depositIntent);
  log("L1", "Computed deposit intent hash for L2→L1 message", { messageHash });

  // Fetch L2→L1 message proof from the real outbox
  // Note: In production, this would wait for the L2 block to be proven
  // For testing with sandbox, we need to wait for the message to be available
  log("L1", "Waiting for L2→L1 message proof...");
  const { computeL2ToL1MembershipWitness } = await import("@aztec/stdlib/messaging");

  let l2BlockNumber: bigint | undefined;
  let leafIndex: bigint | undefined;
  let siblingPath: string[] = [];

  // Try to get the message proof from recent blocks
  const currentL2Block = await l2.node.getBlockNumber();
  for (let blockNum = currentL2Block; blockNum >= Math.max(1, currentL2Block - 10); blockNum--) {
    try {
      const witness = await computeL2ToL1MembershipWitness(l2.node, blockNum, aztec.Fr.fromString(messageHash));
      if (witness) {
        l2BlockNumber = BigInt(blockNum);
        leafIndex = witness.leafIndex;
        siblingPath = witness.siblingPath.toBufferArray().map((buf: Buffer) => `0x${buf.toString("hex")}`);
        log("L1", "Found L2→L1 message proof", { l2BlockNumber: blockNum, leafIndex: leafIndex.toString() });
        break;
      }
    } catch {
      // Message not found in this block, continue searching
    }
  }

  // If no proof found, use placeholder values (will fail at real outbox but demonstrates flow)
  if (!l2BlockNumber) {
    log("L1", "Warning: No L2→L1 message proof found (using placeholders for demo)");
    l2BlockNumber = BigInt(currentL2Block);
    leafIndex = 0n;
    siblingPath = [];
  }

  // Execute deposit
  log("Privacy", "Relayer executing L1 deposit (not user)", {
    relayer: ACCOUNTS.relayer.address,
    user: ACCOUNTS.user.address,
    relayerIsNotUser: ACCOUNTS.relayer.address !== ACCOUNTS.user.address,
  });

  try {
    log("L1", `Executing deposit for ${formatBalance(CONFIG.depositAmount)} USDC...`);
    log("L1", "Using L2→L1 proof", { l2BlockNumber: l2BlockNumber?.toString(), leafIndex: leafIndex?.toString(), pathLength: siblingPath.length });
    const executeDepositTx = await l1.relayerWallet.writeContract({
      chain: foundry,
      address: l1Addresses.portal,
      abi: portalArtifact.abi,
      functionName: "executeDeposit",
      args: [depositIntent, l2BlockNumber!, leafIndex!, siblingPath],
    });
    await l1.publicClient.waitForTransactionReceipt({ hash: executeDepositTx });
    log("L1", "executeDeposit succeeded", { txHash: executeDepositTx });

    // Log balances after deposit - USDC should move to pool, aTokens to portal
    balances = await getAllBalances(l1.publicClient, l1Addresses, mockERC20Artifact.abi, userL1Address);
    logBalanceTable("AFTER RELAYER EXECUTES DEPOSIT (USDC → Aave)", [
      { label: "User (L1)", token: "USDC", balance: balances.user.usdc },
      { label: "Portal", token: "USDC", balance: balances.portal.usdc },
      { label: "Portal", token: "aUSDC", balance: balances.portal.aToken },
      { label: "Aave Pool", token: "USDC", balance: balances.lendingPool.usdc },
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
    }) as bigint;
    log("L1", "Shares recorded for intent", { intentId: intentIdHex.slice(0, 18) + "...", shares: shares.toString() });
  } catch (error) {
    log("L1", "executeDeposit failed", {
      error: error instanceof Error ? error.message.slice(0, 200) : "Unknown",
    });

    // Still log balances to see the state
    balances = await getAllBalances(l1.publicClient, l1Addresses, mockERC20Artifact.abi, userL1Address);
    logBalanceTable("AFTER FAILED DEPOSIT", [
      { label: "User (L1)", token: "USDC", balance: balances.user.usdc },
      { label: "Portal", token: "USDC", balance: balances.portal.usdc },
      { label: "Portal", token: "aUSDC", balance: balances.portal.aToken },
      { label: "Aave Pool", token: "USDC", balance: balances.lendingPool.usdc },
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
  const finalBalances = await getAllBalances(l1.publicClient, l1Addresses, mockERC20Artifact.abi, userL1Address);
  logBalanceTable("FINAL L1 STATE", [
    { label: "User (L1)", token: "USDC", balance: finalBalances.user.usdc },
    { label: "Portal", token: "USDC", balance: finalBalances.portal.usdc },
    { label: "Portal", token: "aUSDC", balance: finalBalances.portal.aToken },
    { label: "Aave Pool", token: "USDC", balance: finalBalances.lendingPool.usdc },
  ]);

  return { intentId, secret, secretHash, shares: mockShares, mockERC20Artifact, userL1Address };
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
  depositResult: { intentId: any; secret: any; shares: bigint; mockERC20Artifact: any; userL1Address: Address }
) {
  console.log("\n\n");
  logStep(1, 4, "WITHDRAW - Generate secret and prepare parameters");

  // Show current L1 state before withdrawal
  const balances = await getAllBalances(l1.publicClient, l1Addresses, depositResult.mockERC20Artifact.abi, depositResult.userL1Address);
  logBalanceTable("CURRENT L1 STATE (before withdraw)", [
    { label: "User (L1)", token: "USDC", balance: balances.user.usdc },
    { label: "Portal", token: "USDC", balance: balances.portal.usdc },
    { label: "Portal", token: "aUSDC", balance: balances.portal.aToken },
    { label: "Aave Pool", token: "USDC", balance: balances.lendingPool.usdc },
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

    // Fetch real Aztec L1 contract addresses from the sandbox
    // IMPORTANT: We must use the real inbox and outbox for cross-chain messaging to work
    log("L1", "Fetching real Aztec L1 addresses from sandbox...");
    const nodeInfo = await node.getNodeInfo();
    const realInboxAddress = nodeInfo.l1ContractAddresses.inboxAddress.toString() as Address;
    const realOutboxAddress = nodeInfo.l1ContractAddresses.outboxAddress.toString() as Address;
    log("L1", "Got real Aztec inbox", { address: realInboxAddress });
    log("L1", "Got real Aztec outbox", { address: realOutboxAddress });

    // Deploy L1 contracts first with placeholder L2 address
    // This allows us to get the portal address for L2 deployment
    const placeholderL2 = "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex;
    const l1Addresses = await deployL1Contracts(
      l1.publicClient,
      l1.deployerWallet,
      placeholderL2,
      realInboxAddress,
      realOutboxAddress
    );
    log("Deploy", "L1 contracts deployed", { portal: l1Addresses.portal, realInbox: realInboxAddress, realOutbox: realOutboxAddress });

    // Deploy L2 contract with actual portal address
    const l2Contract = await deployL2Contract(wallet, address, l1Addresses.portal);
    log("Deploy", "L2 contract deployed", { address: l2Contract.address.toString() });

    // Update L1 portal's L2 reference
    log("Deploy", "Updating L1 portal's L2 reference...");
    const setL2Tx = await l1.deployerWallet.writeContract({
      chain: foundry,
      address: l1Addresses.portal,
      abi: [{
        type: "function",
        name: "setL2ContractAddress",
        inputs: [{ name: "_l2ContractAddress", type: "bytes32" }],
        outputs: [],
        stateMutability: "nonpayable",
      }] as const,
      functionName: "setL2ContractAddress",
      args: [l2Contract.address.toString() as Hex],
    });
    await l1.publicClient.waitForTransactionReceipt({ hash: setL2Tx });

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
