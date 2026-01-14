# SolidJS Frontend Requirements for Aztec Aave Wrapper

> **Generated:** 2026-01-14 | **Purpose:** Grounded research document for building a minimal frontend

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Core Workflow](#core-workflow)
3. [Dependencies and Setup](#dependencies-and-setup)
4. [UI Component Library (solid-ui)](#ui-component-library-solid-ui)
5. [Required SDK Modules](#required-sdk-modules)
6. [L1 Operations (viem)](#l1-operations-viem)
7. [L2 Operations (Aztec SDK)](#l2-operations-aztec-sdk)
8. [Contract Interactions](#contract-interactions)
9. [Data Types](#data-types)
10. [Execution Flows](#execution-flows)
11. [SolidJS Implementation Patterns](#solidjs-implementation-patterns)
12. [State Management Architecture](#state-management-architecture)
13. [UI Components Required](#ui-components-required)
14. [Configuration](#configuration)
15. [Invariants and Constraints](#invariants-and-constraints)

---

## System Overview

Build a minimal SolidJS frontend that replicates the workflow in `e2e/scripts/full-flow.ts:920-994`.

**Boundaries:**
- In scope: Full deposit/withdraw flow execution against local devnets (Anvil L1 + Aztec Sandbox)
- Out of scope: Production deployment, multi-asset support, testnet integration

**Entry points:**
- L1 RPC: `http://localhost:8545` (Anvil)
- L2 PXE: `http://localhost:8081` (Aztec Sandbox)

**Architecture (from `CLAUDE.md:4-7`):**
- Two-layer: L2 (Noir/Aztec) creates private intents, L1 (Solidity) executes Aave operations
- Privacy model: `hash(ownerL2)` protects user identity across chains

---

## Core Workflow

The full-flow script (`e2e/scripts/full-flow.ts:5-14`) demonstrates:

### DEPOSIT FLOW (L2 → L1 → L2):
1. **User calls `request_deposit()` on L2** → creates L2→L1 message
2. **Relayer calls `executeDeposit()` on L1 portal** → supplies to Aave, sends L1→L2 message
3. **User calls `finalize_deposit()` on L2** → creates PositionReceiptNote

### WITHDRAW FLOW (L2 → L1 → L2):
1. **User calls `request_withdraw()` on L2** → consumes note, creates L2→L1 message
2. **Relayer calls `executeWithdraw()` on L1 portal** → withdraws from Aave, sends L1→L2 message
3. **User calls `finalize_withdraw()` on L2** → tokens credited to user

---

## Dependencies and Setup

### Package Requirements

From `e2e/package.json:21-28`:

```json
{
  "dependencies": {
    "@aztec/aztec.js": "3.0.0-devnet.20251212",
    "@aztec/stdlib": "3.0.0-devnet.20251212",
    "@aztec/accounts": "3.0.0-devnet.20251212",
    "@aztec/foundation": "3.0.0-devnet.20251212",
    "@aztec/test-wallet": "3.0.0-devnet.20251212",
    "viem": "^2.21.0"
  }
}
```

### SolidJS Setup

```bash
npm create solid@latest
# Select: No to SolidStart (simple SPA)
# Select: TypeScript template
```

Additional SolidJS dependencies:
```bash
npm install solid-js @solidjs/router
```

---

## UI Component Library (solid-ui)

Use **solid-ui** - an unofficial port of shadcn/ui to SolidJS. This provides copy-paste components built on Kobalte (headless primitives), corvu, and Tailwind CSS.

**Source:** https://github.com/sek-consulting/solid-ui
**Documentation:** https://www.solid-ui.com

### Installation with Vite

#### Step 1: Install Tailwind CSS

```bash
npm install -D tailwindcss@3 postcss autoprefixer
npx tailwindcss init -p
```

#### Step 2: Configure TypeScript paths

Update `tsconfig.json`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "~/*": ["./src/*"]
    }
  }
}
```

#### Step 3: Configure Vite

```bash
npm i -D @types/node
```

Update `vite.config.ts`:

```typescript
import path from "path"
import solid from 'vite-plugin-solid';
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./src")
    }
  }
})
```

#### Step 4: Initialize solid-ui CLI

```bash
npx solidui-cli@latest init
```

Configure prompts:
- TypeScript: Yes
- CSS file location: `src/index.css`
- Tailwind config: `tailwind.config.js`
- Import alias: `~/`

#### Step 5: Add components as needed

```bash
npx solidui-cli@latest add button
npx solidui-cli@latest add card
npx solidui-cli@latest add input
npx solidui-cli@latest add progress
npx solidui-cli@latest add alert
npx solidui-cli@latest add badge
npx solidui-cli@latest add tabs
npx solidui-cli@latest add toast
```

### Recommended Components for This App

| Component | Use Case |
|-----------|----------|
| **Button** | Action triggers (Deploy, Deposit, Withdraw) |
| **Card** | Container for ConnectionStatus, WalletInfo, PositionCard |
| **Input** / **Number Field** | Amount input fields |
| **Badge** | Status indicators (Connected, Pending, Success) |
| **Progress** | Step indicators for multi-step flows |
| **Alert** | Error messages, success notifications |
| **Tabs** | Switch between Deposit/Withdraw flows |
| **Toast** | Transaction confirmations, log entries |
| **Skeleton** | Loading states during async operations |
| **Separator** | Visual dividers |
| **Label** | Form field labels |
| **Select** | Position selector for withdrawal |

### Component Import Pattern

After adding via CLI, components are available locally:

```tsx
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/badge";
import { Progress } from "~/components/ui/progress";
import { Alert, AlertDescription } from "~/components/ui/alert";
```

### Example Usage

```tsx
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Show } from "solid-js";

function ConnectionStatus(props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center justify-between">
          L1 Connection
          <Badge variant={props.connected ? "default" : "destructive"}>
            {props.connected ? "Connected" : "Disconnected"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Show when={props.connected}>
          <p class="text-sm text-muted-foreground">
            Chain ID: {props.chainId}
          </p>
        </Show>
        <Show when={!props.connected}>
          <Button onClick={props.onConnect}>Connect</Button>
        </Show>
      </CardContent>
    </Card>
  );
}
```

### Step Indicator Pattern

For multi-step flows (deposit has 6 steps, withdraw has 4):

```tsx
import { Progress } from "~/components/ui/progress";

function StepIndicator(props) {
  const percentage = () => (props.currentStep / props.totalSteps) * 100;

  return (
    <div class="space-y-2">
      <div class="flex justify-between text-sm">
        <span>Step {props.currentStep} of {props.totalSteps}</span>
        <span>{props.stepLabel}</span>
      </div>
      <Progress value={percentage()} />
    </div>
  );
}
```

---

## Required SDK Modules

### Aztec SDK Imports

From `e2e/scripts/full-flow.ts:377-396`:

```typescript
// Fields
import { Fr } from "@aztec/aztec.js/fields";

// Addresses
import { AztecAddress } from "@aztec/aztec.js/addresses";

// Node client
import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";

// Hashing
import { computeSecretHash } from "@aztec/stdlib/hash";
import { poseidon2Hash } from "@aztec/foundation/crypto/poseidon";

// Test wallet
import { TestWallet } from "@aztec/test-wallet/server";
import {
  INITIAL_TEST_SECRET_KEYS,
  INITIAL_TEST_SIGNING_KEYS,
  INITIAL_TEST_ACCOUNT_SALTS,
} from "@aztec/accounts/testing";

// Contract wrapper
import { AaveWrapperContract } from "../src/generated/AaveWrapper";
import { EthAddress } from "@aztec/foundation/eth-address";
```

### viem Imports

From `e2e/scripts/full-flow.ts:23-37`:

```typescript
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
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
```

---

## L1 Operations (viem)

### Client Setup

From `e2e/scripts/full-flow.ts:336-371`:

```typescript
const CONFIG = {
  l1RpcUrl: "http://localhost:8545",
  l2RpcUrl: "http://localhost:8081",
  depositAmount: 1_000_000n, // 1 USDC (6 decimals)
  withdrawAmount: 1_000_000n,
  assetId: 1n,
  originalDecimals: 6,
  deadlineOffset: 3600, // 1 hour
};

// Anvil test accounts (DO NOT use in production)
const ACCOUNTS = {
  deployer: privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"),
  user: privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"),
  relayer: privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"),
};

const publicClient = createPublicClient({
  chain: foundry,
  transport: http(CONFIG.l1RpcUrl),
});

const walletClient = createWalletClient({
  account: ACCOUNTS.user,
  chain: foundry,
  transport: http(CONFIG.l1RpcUrl),
});
```

### L1 Contract Deployment

The full-flow deploys mock contracts (`e2e/scripts/full-flow.ts:221-330`):
- MockERC20 (USDC)
- MockERC20 (aUSDC)
- MockAztecOutbox
- MockAztecInbox
- MockTokenPortal
- MockAaveLendingPool
- AztecAavePortalL1

**Key addresses interface** (`e2e/scripts/full-flow.ts:74-82`):

```typescript
interface L1Addresses {
  portal: Address;
  mockUsdc: Address;
  mockAToken: Address;
  mockLendingPool: Address;
  mockAztecOutbox: Address;
  mockAztecInbox: Address;
  mockTokenPortal: Address;
}
```

### Loading Contract Artifacts

From `e2e/scripts/full-flow.ts:205-215`:

```typescript
function loadArtifact(contractPath: string, contractName: string) {
  const artifactPath = `eth/out/${contractPath}/${contractName}.json`;
  const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as Hex,
  };
}
```

### ERC20 Operations

From `e2e/scripts/full-flow.ts:628-663`:

```typescript
// Mint USDC to user
await walletClient.writeContract({
  address: l1Addresses.mockUsdc,
  abi: erc20Abi,
  functionName: "mint",
  args: [userAddress, amount],
});

// Approve portal
await walletClient.writeContract({
  address: l1Addresses.mockUsdc,
  abi: erc20Abi,
  functionName: "approve",
  args: [l1Addresses.portal, amount],
});

// Transfer to portal
await walletClient.writeContract({
  address: l1Addresses.mockUsdc,
  abi: erc20Abi,
  functionName: "transfer",
  args: [l1Addresses.portal, amount],
});
```

### Execute Deposit on L1

From `e2e/scripts/full-flow.ts:720-728`:

```typescript
await relayerWallet.writeContract({
  address: l1Addresses.portal,
  abi: portalArtifact.abi,
  functionName: "executeDeposit",
  args: [depositIntent, l2BlockNumber, leafIndex, siblingPath],
});
```

### Mining L1 Blocks

From `e2e/scripts/full-flow.ts:481-495`:

```typescript
async function mineL1Block(publicClient: PublicClient) {
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
}
```

---

## L2 Operations (Aztec SDK)

### Node Client Setup

From `e2e/scripts/full-flow.ts:399-409`:

```typescript
async function setupL2Client(aztec: AztecModules) {
  const node = aztec.createAztecNodeClient(CONFIG.l2RpcUrl);
  await aztec.waitForNode(node);

  const nodeInfo = await node.getNodeInfo();
  console.log("Connected to Aztec", { version: nodeInfo.nodeVersion });

  return node;
}
```

### Wallet Setup with Test Accounts

From `e2e/scripts/full-flow.ts:411-434`:

```typescript
async function setupL2Wallet(aztec: AztecModules, node) {
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

  return { wallet, address: accountManager.address };
}
```

### L2 Contract Deployment

From `e2e/scripts/full-flow.ts:440-463`:

```typescript
async function deployL2Contract(wallet, walletAddress, portalAddress: Address) {
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

  return deployedContract;
}
```

---

## Contract Interactions

### L2 AaveWrapper Contract Methods

From `e2e/src/generated/AaveWrapper.ts:128-172`:

```typescript
// Request deposit
methods.request_deposit(
  asset: FieldLike,           // Asset identifier
  amount: bigint | number,    // Amount to deposit
  original_decimals: number,  // Token decimals (6 for USDC)
  deadline: bigint | number,  // Unix timestamp deadline
  secret_hash: FieldLike      // Hash of secret for L1→L2 claiming
): ContractFunctionInteraction

// Finalize deposit
methods.finalize_deposit(
  intent_id: FieldLike,
  asset_id: FieldLike,
  shares: bigint | number,
  secret: FieldLike,
  message_leaf_index: FieldLike
): ContractFunctionInteraction

// Request withdraw
methods.request_withdraw(
  nonce: FieldLike,           // Position nonce (same as intent_id)
  amount: bigint | number,
  deadline: bigint | number,
  secret_hash: FieldLike
): ContractFunctionInteraction

// Finalize withdraw
methods.finalize_withdraw(
  intent_id: FieldLike,
  asset_id: FieldLike,
  amount: bigint | number,
  secret: FieldLike,
  message_leaf_index: FieldLike
): ContractFunctionInteraction
```

### L1 Portal Contract Methods

From `eth/contracts/AztecAavePortalL1.sol:173-244`:

```solidity
function executeDeposit(
    DepositIntent calldata intent,
    uint256 l2BlockNumber,
    uint256 leafIndex,
    bytes32[] calldata siblingPath
) external whenNotPaused

function executeWithdraw(
    WithdrawIntent calldata intent,
    bytes32 secretHash,
    uint256 l2BlockNumber,
    uint256 leafIndex,
    bytes32[] calldata siblingPath
) external whenNotPaused
```

---

## Data Types

### DepositIntent (L1)

From `eth/contracts/types/Intent.sol` (referenced in `full-flow.ts:691-700`):

```typescript
interface DepositIntent {
  intentId: Hex;        // bytes32
  ownerHash: Hex;       // bytes32 - hash(ownerL2)
  asset: Address;       // address - token address
  amount: bigint;       // uint128
  originalDecimals: number; // uint8
  deadline: bigint;     // uint64
  salt: Hex;            // bytes32
}
```

### WithdrawIntent (L1)

From `eth/contracts/AztecAavePortalL1.sol:265-270`:

```typescript
interface WithdrawIntent {
  intentId: Hex;
  ownerHash: Hex;
  amount: bigint;
  deadline: bigint;
}
```

### PositionReceiptNote (L2 private)

From `aztec/src/main.nr:466-473`:

```typescript
// Private note structure (encrypted)
interface PositionReceiptNote {
  owner: AztecAddress;
  nonce: Field;
  asset_id: Field;
  shares: bigint;      // u128
  aave_market_id: number;
  status: PositionStatus; // ACTIVE | PENDING_WITHDRAW
}
```

### IntentStatus (L2 public)

From `aztec/src/main.nr:200-212`:

```typescript
enum IntentStatus {
  UNKNOWN = 0,
  PENDING_DEPOSIT = 1,
  CONFIRMED = 2,
  FAILED = 3,
  PENDING_WITHDRAW = 4
}
```

---

## Execution Flows

### Flow: Complete Deposit

From `e2e/scripts/full-flow.ts:539-822`:

```
1. Generate secret: Fr.random()
2. Compute secretHash: computeSecretHash(secret)
3. Get L1 timestamp for deadline
4. Compute ownerHash: poseidon2Hash([l2Address.toBigInt()])
5. Call request_deposit() on L2
   → Returns intentId
   → Sends L2→L1 message
6. Wait for L2 blocks: sleep + mineAztecBlocks
7. Fund portal with USDC:
   a. Mint USDC to user
   b. Approve portal
   c. Transfer to portal
8. Prepare DepositIntent struct
9. Compute message hash
10. Set message valid in mock outbox
11. Call executeDeposit() on L1 (relayer)
    → Supplies to Aave
    → Records shares
    → Sends L1→L2 message
12. Mine L1 block
13. Wait for L2 blocks
14. Call finalize_deposit() on L2
    → Consumes L1→L2 message
    → Creates PositionReceiptNote
```

**Failure paths:**
- If deadline passed: `DeadlinePassed()` error (`eth/contracts/AztecAavePortalL1.sol:186`)
- If intent already consumed: `IntentAlreadyConsumed()` error (`eth/contracts/AztecAavePortalL1.sol:180`)
- If L1→L2 message not found: `finalize_deposit` reverts (`aztec/src/main.nr:459`)

### Flow: Complete Withdrawal

From `e2e/scripts/full-flow.ts:828-914`:

```
1. Generate withdrawSecret: Fr.random()
2. Compute withdrawSecretHash
3. Compute deadline
4. Call request_withdraw() on L2
   → Nullifies Active note
   → Creates PendingWithdraw note
   → Returns withdrawIntentId
   → Sends L2→L1 message
5. Wait for L2→L1 message availability
6. Call executeWithdraw() on L1 (relayer)
   → Withdraws from Aave
   → Deposits to TokenPortal for L2
   → Sends L1→L2 confirmation
7. Wait for L1→L2 message
8. Call finalize_withdraw() on L2
   → Consumes L1→L2 message
   → Nullifies PendingWithdraw note
```

**Failure paths:**
- If position not found: `"Position receipt note not found"` (`aztec/src/main.nr:575`)
- If partial withdrawal: `"Must withdraw full position"` (`aztec/src/main.nr:585-588`)
- If no shares recorded: `NoSharesForIntent()` (`eth/contracts/AztecAavePortalL1.sol:287`)

---

## SolidJS Implementation Patterns

### Core Primitives

From `/home/ametel/source/solid-docs/AGENTS/LLM.md:51-62`:

```tsx
import { createSignal, createEffect, createResource, createMemo } from "solid-js";
import { createStore } from "solid-js/store";

// Reactive state
const [count, setCount] = createSignal(0);

// Complex state
const [store, setStore] = createStore({
  user: { name: "John" },
  items: []
});

// Derived values
const doubled = createMemo(() => count() * 2);

// Async data
const [data] = createResource(fetchData);
```

### Key SolidJS Rules

From `/home/ametel/source/solid-docs/AGENTS/LLM.md:77-83`:

1. **Call signals as functions**: `count()` not `count`
2. **Don't destructure props**: breaks reactivity
3. **Components run once**: only reactive parts update
4. **Use control flow components**: `<Show>`, `<For>`, `<Switch>`

### Resource Pattern for Async Operations

From `/home/ametel/source/solid-docs/AGENTS/llm_corpus/007-resources.md:29-44`:

```tsx
import { createResource, Suspense, ErrorBoundary } from "solid-js";

const [deposit, { mutate, refetch }] = createResource(
  () => intentId(),  // Source
  async (id) => {
    // Fetch deposit status
  }
);

// Resource properties
deposit()         // data or undefined
deposit.loading   // boolean
deposit.error     // error or undefined
deposit.state     // "unresolved" | "pending" | "ready" | "refreshing" | "errored"
```

### Store Pattern for Complex State

From `/home/ametel/source/solid-docs/AGENTS/llm_corpus/005-stores.md:42-56`:

```tsx
import { createStore, produce } from "solid-js/store";

const [state, setState] = createStore({
  l1: { connected: false, chainId: 0 },
  l2: { connected: false, nodeVersion: "" },
  contracts: { portal: null, wrapper: null },
  deposit: { status: "idle", intentId: null },
  withdraw: { status: "idle", intentId: null }
});

// Update nested property
setState("l1", "connected", true);

// Immer-style update
setState(produce(s => {
  s.deposit.status = "pending";
  s.deposit.intentId = newId;
}));
```

---

## State Management Architecture

### Recommended Store Structure

```typescript
interface AppState {
  // Connection status
  l1: {
    connected: boolean;
    chainId: number;
    blockNumber: number;
  };
  l2: {
    connected: boolean;
    nodeVersion: string;
    blockNumber: number;
  };

  // Wallet state
  wallet: {
    l1Address: Address | null;
    l2Address: string | null;
    usdcBalance: bigint;
    aTokenBalance: bigint;
  };

  // Contract addresses (deployed)
  contracts: L1Addresses & {
    l2Wrapper: string | null;
  };

  // Current operation
  operation: {
    type: "idle" | "deposit" | "withdraw";
    step: number;
    totalSteps: number;
    status: "pending" | "success" | "error";
    intentId: string | null;
    error: string | null;
    logs: LogEntry[];
  };

  // Positions
  positions: Array<{
    intentId: string;
    assetId: string;
    shares: bigint;
    status: IntentStatus;
  }>;
}
```

### Context Provider Pattern

From `/home/ametel/source/solid-docs/AGENTS/LLM.md:1109-1131`:

```tsx
import { createContext, useContext } from "solid-js";

const AppContext = createContext<{
  state: AppState;
  actions: AppActions;
}>();

export function AppProvider(props) {
  const [state, setState] = createStore<AppState>({...});

  const actions = {
    connectL1: async () => {...},
    connectL2: async () => {...},
    deployContracts: async () => {...},
    executeDeposit: async (params) => {...},
    executeWithdraw: async (params) => {...},
  };

  return (
    <AppContext.Provider value={{ state, actions }}>
      {props.children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
```

---

## UI Components Required

### Component Hierarchy (with solid-ui mappings)

```
App
├── ConnectionStatus (Card + Badge)
│   ├── L1Status (Anvil)
│   └── L2Status (Aztec Sandbox)
├── WalletInfo (Card)
│   ├── L1Balances (USDC, aUSDC)
│   └── L2Address
├── ContractDeployment (Card + Button)
│   ├── DeployButton
│   └── AddressList
├── OperationTabs (Tabs)
│   ├── DepositFlow (Card)
│   │   ├── AmountInput (Input + Label)
│   │   ├── DeadlineSelector (Input + Label)
│   │   ├── StepIndicator (Progress)
│   │   └── ActionButton (Button)
│   └── WithdrawFlow (Card)
│       ├── PositionSelector (Select)
│       ├── DeadlineSelector (Input + Label)
│       ├── StepIndicator (Progress)
│       └── ActionButton (Button)
├── PositionsList (Card)
│   └── PositionCard (Card + Badge) for each position
└── LogViewer (Card + Toast integration)
    └── LogEntry[]
```

### solid-ui Component Imports

```tsx
// UI Components from solid-ui
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Badge } from "~/components/ui/badge";
import { Progress } from "~/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Separator } from "~/components/ui/separator";
import { Skeleton } from "~/components/ui/skeleton";

// SolidJS Control Flow
import { Show, For, Switch, Match, Suspense, ErrorBoundary } from "solid-js";
```

### Example: Main App Layout

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

function App() {
  return (
    <div class="container mx-auto p-4 space-y-4">
      {/* Header */}
      <div class="flex gap-4">
        <ConnectionStatus type="l1" />
        <ConnectionStatus type="l2" />
      </div>

      {/* Wallet Info */}
      <WalletInfo />

      {/* Contract Deployment */}
      <ContractDeployment />

      {/* Main Operations */}
      <Tabs defaultValue="deposit">
        <TabsList class="grid w-full grid-cols-2">
          <TabsTrigger value="deposit">Deposit</TabsTrigger>
          <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
        </TabsList>
        <TabsContent value="deposit">
          <DepositFlow />
        </TabsContent>
        <TabsContent value="withdraw">
          <WithdrawFlow />
        </TabsContent>
      </Tabs>

      {/* Positions */}
      <PositionsList />

      {/* Logs */}
      <LogViewer />
    </div>
  );
}
```

### Example: Deposit Flow Component

```tsx
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Progress } from "~/components/ui/progress";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Show, Switch, Match } from "solid-js";

function DepositFlow() {
  const { state, actions } = useApp();

  const stepLabels = [
    "Generate secret",
    "Request deposit on L2",
    "Wait for L2→L1 message",
    "Fund portal with USDC",
    "Execute deposit on L1",
    "Finalize deposit on L2"
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deposit to Aave</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        {/* Amount Input */}
        <div class="space-y-2">
          <Label for="amount">Amount (USDC)</Label>
          <Input
            id="amount"
            type="number"
            placeholder="1.00"
            value={state.deposit.amount}
            onInput={(e) => actions.setDepositAmount(e.target.value)}
          />
        </div>

        {/* Step Progress */}
        <Show when={state.operation.type === "deposit"}>
          <div class="space-y-2">
            <div class="flex justify-between text-sm">
              <span>Step {state.operation.step} of {stepLabels.length}</span>
              <span class="text-muted-foreground">
                {stepLabels[state.operation.step - 1]}
              </span>
            </div>
            <Progress value={(state.operation.step / stepLabels.length) * 100} />
          </div>
        </Show>

        {/* Error Alert */}
        <Show when={state.operation.error}>
          <Alert variant="destructive">
            <AlertDescription>{state.operation.error}</AlertDescription>
          </Alert>
        </Show>
      </CardContent>
      <CardFooter>
        <Button
          class="w-full"
          disabled={state.operation.status === "pending"}
          onClick={actions.executeDeposit}
        >
          <Switch fallback="Deposit">
            <Match when={state.operation.status === "pending"}>
              Processing...
            </Match>
          </Switch>
        </Button>
      </CardFooter>
    </Card>
  );
}
```

### Example: Position Card Component

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";

function PositionCard(props) {
  const statusVariant = () => {
    switch (props.position.status) {
      case 1: return "secondary"; // PENDING_DEPOSIT
      case 2: return "default";   // CONFIRMED (Active)
      case 4: return "outline";   // PENDING_WITHDRAW
      default: return "destructive";
    }
  };

  const statusLabel = () => {
    switch (props.position.status) {
      case 1: return "Pending Deposit";
      case 2: return "Active";
      case 4: return "Pending Withdraw";
      default: return "Unknown";
    }
  };

  const formatShares = (shares: bigint) => {
    return (Number(shares) / 1_000_000).toFixed(6);
  };

  return (
    <Card>
      <CardHeader class="flex flex-row items-center justify-between pb-2">
        <CardTitle class="text-sm font-medium">
          Position #{props.position.intentId.slice(0, 8)}...
        </CardTitle>
        <Badge variant={statusVariant()}>{statusLabel()}</Badge>
      </CardHeader>
      <CardContent>
        <div class="text-2xl font-bold">
          {formatShares(props.position.shares)} aUSDC
        </div>
        <Show when={props.position.status === 2}>
          <Button
            variant="outline"
            size="sm"
            class="mt-2"
            onClick={() => props.onWithdraw(props.position.intentId)}
          >
            Withdraw
          </Button>
        </Show>
      </CardContent>
    </Card>
  );
}
```

### Control Flow Components

From `/home/ametel/source/solid-docs/AGENTS/LLM.md:476-564`:

```tsx
import { Show, For, Switch, Match, Suspense, ErrorBoundary } from "solid-js";
import { Skeleton } from "~/components/ui/skeleton";
import { Alert, AlertDescription } from "~/components/ui/alert";

// Conditional rendering with solid-ui
<Show
  when={state.l1.connected}
  fallback={
    <Card>
      <CardContent class="pt-6">
        <Button onClick={actions.connectL1}>Connect to L1</Button>
      </CardContent>
    </Card>
  }
>
  <WalletInfo />
</Show>

// Lists with positions
<For each={state.positions} fallback={<p class="text-muted-foreground">No positions yet</p>}>
  {(position) => (
    <PositionCard
      position={position}
      onWithdraw={actions.initiateWithdraw}
    />
  )}
</For>

// Multi-condition with loading states
<Switch fallback={<IdleState />}>
  <Match when={state.operation.status === "pending"}>
    <Card>
      <CardContent class="space-y-2 pt-6">
        <Skeleton class="h-4 w-full" />
        <Skeleton class="h-4 w-3/4" />
      </CardContent>
    </Card>
  </Match>
  <Match when={state.operation.status === "error"}>
    <Alert variant="destructive">
      <AlertDescription>{state.operation.error}</AlertDescription>
    </Alert>
  </Match>
  <Match when={state.operation.status === "success"}>
    <Alert>
      <AlertDescription>
        Transaction successful! Intent ID: {state.operation.intentId}
      </AlertDescription>
    </Alert>
  </Match>
</Switch>

// Error boundary
<ErrorBoundary
  fallback={(err, reset) => (
    <Alert variant="destructive">
      <AlertDescription>
        {err.message}
        <Button variant="link" onClick={reset}>Retry</Button>
      </AlertDescription>
    </Alert>
  )}
>
  <AsyncOperation />
</ErrorBoundary>
```

---

## Configuration

### Environment Configuration

From `shared/src/constants.ts:105-121`:

```typescript
export const LOCAL_RPC_URLS = {
  L1: "http://localhost:8545",
  PXE: "http://localhost:8081",
} as const;

export const LOCAL_PRIVATE_KEYS = {
  DEPLOYER: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  USER1: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  USER2: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  RELAYER: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
} as const;
```

### Protocol Constants

From `shared/src/constants.ts:73-85`:

```typescript
export const USDC_DECIMALS = 6;
export const DEFAULT_DEADLINE_OFFSET = 60 * 60;  // 1 hour
export const MAX_DEADLINE_OFFSET = 24 * 60 * 60; // 24 hours
```

### L1 Portal Deadline Constraints

From `eth/contracts/AztecAavePortalL1.sol:54-57`:

```solidity
uint256 public constant MIN_DEADLINE = 5 minutes;
uint256 public constant MAX_DEADLINE = 24 hours;
```

---

## Invariants and Constraints

### Protocol Invariants

From `CLAUDE.md:23-29`:

1. **Per-intent share tracking**: L1 portal tracks shares per intent ID (not per owner) to maintain privacy
2. **Full withdrawal only**: Withdrawals must be for the entire position
3. **Retry queue**: Failed operations queued indefinitely, retryable by original caller
4. **Deadline enforcement at L1**: 5 min minimum, 24 hour maximum

### MVP Constraints

From `CLAUDE.md:31-32`:

- **USDC-only**: MVP focuses on single asset support
- **L1 Aave only**: Direct deposit to Ethereum L1 Aave pool

### Privacy Invariants

From `aztec/src/main.nr:346-347` and `eth/contracts/AztecAavePortalL1.sol:170-171`:

- **ownerHash**: L2 owner address is hashed (Poseidon) before inclusion in cross-chain messages
- Owner identity is never revealed on L1
- L1 execution doesn't require user identity ("anyone can execute" relay model)

### Amount Constraints

From `aztec/src/main.nr:337`:

```
- Amount must be > 0
- Deadline must be > 0 (validation enforced on L1)
```

### Withdrawal Constraints

From `aztec/src/main.nr:585-588`:

```
- MVP: Only full withdrawals supported (amount == receipt.shares)
- Position must be in Active status
- Note must exist and be owned by caller
```

---

## Open Questions

- `[INFERRED]` Browser compatibility of Aztec SDK - may need polyfills for crypto primitives
- `[UNCLEAR]` Hot module reloading with dynamic Aztec imports
- `[INFERRED]` For local devnet, contracts need to be deployed on each session start (no persistence)

## Divergences from Script

| Script | Frontend | Classification |
|--------|----------|----------------|
| Deploys contracts each run | Persists contract addresses in local storage | Enhancement |
| Console logging | UI log viewer component | Enhancement |
| Serial execution | User-triggered steps with progress | UX |
| Test wallet hardcoded | Could allow wallet connection | Future |

---

*End of Frontend Requirements Document*
