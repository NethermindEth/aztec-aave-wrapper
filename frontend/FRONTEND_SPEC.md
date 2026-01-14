# Frontend Implementation Specification

This document specifies the requirements for making the Aztec Aave Wrapper frontend fully functional, based on the e2e test flows.

## Overview

The frontend needs to orchestrate cross-chain operations between:
- **L2 (Aztec)**: Private user actions via Azguard wallet
- **L1 (Ethereum)**: Portal contract execution via MetaMask

### Architecture

```
User Flow:
┌─────────────────────────────────────────────────────────────────────┐
│                           DEPOSIT FLOW                               │
├─────────────────────────────────────────────────────────────────────┤
│  L2 (Aztec)          │  L1 (Ethereum)       │  L2 (Aztec)           │
│                      │                      │                        │
│  1. request_deposit  │  2. executeDeposit   │  3. finalize_deposit  │
│     (User/Private)   │     (Relayer/Public) │     (User/Private)    │
│                      │                      │                        │
│  - Generate secret   │  - Consume L2→L1 msg │  - Consume L1→L2 msg  │
│  - Send L2→L1 msg    │  - Supply to Aave    │  - Create receipt note│
│  - Return intent_id  │  - Send L1→L2 msg    │  - Mark complete      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                          WITHDRAW FLOW                               │
├─────────────────────────────────────────────────────────────────────┤
│  L2 (Aztec)          │  L1 (Ethereum)       │  L2 (Aztec)           │
│                      │                      │                        │
│  1. request_withdraw │  2. executeWithdraw  │  3. finalize_withdraw │
│     (User/Private)   │     (Relayer/Public) │     (User/Private)    │
│                      │                      │                        │
│  - Find receipt note │  - Consume L2→L1 msg │  - Consume L1→L2 msg  │
│  - Nullify note      │  - Withdraw from Aave│  - Update note status │
│  - Send L2→L1 msg    │  - Send L1→L2 msg    │  - Mark complete      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. Contract Interactions Required

### 1.1 L2 Contract (AaveWrapper - Noir)

**Contract Address**: Loaded from `.deployments.local.json` → `l2.aaveWrapper`

#### Deposit Functions

```typescript
// Step 1: Request deposit (private function)
request_deposit(
  asset: Field,           // Asset ID (1n for USDC)
  amount: u128,           // Amount in raw units (1_000_000n = 1 USDC)
  original_decimals: u8,  // Token decimals (6 for USDC)
  deadline: u64,          // Unix timestamp
  secret_hash: Field      // Hash of user's secret
) → Field                 // Returns: intent_id

// Step 3: Finalize deposit (private function)
finalize_deposit(
  intent_id: Field,
  asset_id: Field,
  shares: u128,           // Shares from L1 confirmation
  secret: Field,          // Pre-image of secret_hash
  message_leaf_index: Field
)
```

#### Withdraw Functions

```typescript
// Step 1: Request withdraw (private function)
request_withdraw(
  nonce: Field,           // Position receipt nonce (= original intent_id)
  amount: u128,           // Must equal total shares (full withdrawal only)
  deadline: u64,
  secret_hash: Field
) → Field                 // Returns: new intent_id

// Step 3: Finalize withdraw (private function)
finalize_withdraw(
  intent_id: Field,
  asset_id: Field,
  amount: u128,
  secret: Field,
  message_leaf_index: Field
)
```

### 1.2 L1 Contract (AztecAavePortalL1 - Solidity)

**Contract Address**: Loaded from `.deployments.local.json` → `l1.portal`

```solidity
// Execute deposit (called by relayer, can be user)
function executeDeposit(
  DepositIntent calldata intent,
  uint256 l2BlockNumber,
  uint256 leafIndex,
  bytes32[] calldata siblingPath
) external;

// Execute withdraw (called by relayer, can be user)
function executeWithdraw(
  WithdrawIntent calldata intent,
  uint256 l2BlockNumber,
  uint256 leafIndex,
  bytes32[] calldata siblingPath
) external;

// Intent structs
struct DepositIntent {
  bytes32 intentId;
  bytes32 ownerHash;
  address asset;
  uint256 amount;
  uint8 originalDecimals;
  uint256 deadline;
}

struct WithdrawIntent {
  bytes32 intentId;
  bytes32 ownerHash;
  address asset;
  uint256 amount;
  uint256 deadline;
}
```

### 1.3 L1 Token Contract (MockERC20)

**Contract Address**: Loaded from `.deployments.local.json` → `l1.mockUsdc`

```solidity
// Approve portal to spend USDC before deposit
function approve(address spender, uint256 amount) external returns (bool);

// Check balance
function balanceOf(address account) external view returns (uint256);
```

---

## 2. Frontend Services to Implement

### 2.1 Aztec Contract Service

**File**: `frontend/src/services/l2/contract.ts`

```typescript
interface AztecContractService {
  // Load the deployed AaveWrapper contract
  loadContract(wallet: AzguardWallet): Promise<AaveWrapperContract>;

  // Deposit operations
  requestDeposit(params: {
    asset: bigint;
    amount: bigint;
    originalDecimals: number;
    deadline: bigint;
    secretHash: bigint;
  }): Promise<{ intentId: bigint; txHash: string }>;

  finalizeDeposit(params: {
    intentId: bigint;
    assetId: bigint;
    shares: bigint;
    secret: bigint;
    messageLeafIndex: bigint;
  }): Promise<{ txHash: string }>;

  // Withdraw operations
  requestWithdraw(params: {
    nonce: bigint;
    amount: bigint;
    deadline: bigint;
    secretHash: bigint;
  }): Promise<{ intentId: bigint; txHash: string }>;

  finalizeWithdraw(params: {
    intentId: bigint;
    assetId: bigint;
    amount: bigint;
    secret: bigint;
    messageLeafIndex: bigint;
  }): Promise<{ txHash: string }>;

  // Query user's position notes
  getPositionNotes(userAddress: string): Promise<PositionNote[]>;
}
```

### 2.2 L1 Portal Service

**File**: `frontend/src/services/l1/portal.ts`

```typescript
interface PortalService {
  // Execute deposit on L1 (after L2 request)
  executeDeposit(params: {
    intent: DepositIntent;
    l2BlockNumber: bigint;
    leafIndex: bigint;
    siblingPath: string[];
  }): Promise<{ txHash: string; shares: bigint }>;

  // Execute withdraw on L1 (after L2 request)
  executeWithdraw(params: {
    intent: WithdrawIntent;
    l2BlockNumber: bigint;
    leafIndex: bigint;
    siblingPath: string[];
  }): Promise<{ txHash: string; amount: bigint }>;

  // Check intent status
  isIntentConsumed(intentId: string): Promise<boolean>;
  getIntentShares(intentId: string): Promise<bigint>;
}
```

### 2.3 Message Service

**File**: `frontend/src/services/messages.ts`

```typescript
interface MessageService {
  // Wait for L2→L1 message to be available
  waitForL2ToL1Message(params: {
    intentId: bigint;
    timeout?: number;
  }): Promise<{
    l2BlockNumber: bigint;
    leafIndex: bigint;
    siblingPath: string[];
  }>;

  // Wait for L1→L2 message to be available
  waitForL1ToL2Message(params: {
    intentId: bigint;
    timeout?: number;
  }): Promise<{
    messageLeafIndex: bigint;
  }>;
}
```

### 2.4 Crypto Utilities

**File**: `frontend/src/services/crypto.ts`

```typescript
interface CryptoService {
  // Generate random secret for authentication
  generateSecret(): bigint;

  // Compute secret hash (Poseidon hash)
  computeSecretHash(secret: bigint): Promise<bigint>;

  // Compute expected intent ID (for verification)
  computeIntentId(params: {
    caller: string;
    asset: bigint;
    amount: bigint;
    originalDecimals: number;
    deadline: bigint;
    salt: bigint;
  }): Promise<bigint>;

  // Compute salt for intent
  computeSalt(caller: string, secretHash: bigint): Promise<bigint>;
}
```

---

## 3. Flow Orchestrators

### 3.1 Deposit Flow Orchestrator

**File**: `frontend/src/flows/deposit.ts`

```typescript
interface DepositFlowParams {
  amount: bigint;           // USDC amount (raw units, 6 decimals)
  deadlineSeconds: number;  // Seconds from now
}

interface DepositFlowResult {
  intentId: string;
  l2RequestTxHash: string;
  l1ExecuteTxHash: string;
  l2FinalizeTxHash: string;
  shares: bigint;
}

class DepositFlowOrchestrator {
  constructor(
    private aztecService: AztecContractService,
    private portalService: PortalService,
    private messageService: MessageService,
    private cryptoService: CryptoService
  ) {}

  async execute(params: DepositFlowParams): AsyncGenerator<DepositStep> {
    // Step 1: Generate secret
    yield { step: 1, status: 'generating_secret' };
    const secret = this.cryptoService.generateSecret();
    const secretHash = await this.cryptoService.computeSecretHash(secret);

    // Step 2: Request deposit on L2
    yield { step: 2, status: 'requesting_deposit' };
    const deadline = BigInt(Math.floor(Date.now() / 1000) + params.deadlineSeconds);
    const { intentId, txHash: l2TxHash } = await this.aztecService.requestDeposit({
      asset: 1n,  // USDC
      amount: params.amount,
      originalDecimals: 6,
      deadline,
      secretHash,
    });
    yield { step: 2, status: 'complete', intentId, txHash: l2TxHash };

    // Step 3: Wait for L2→L1 message
    yield { step: 3, status: 'waiting_for_message' };
    const l2Message = await this.messageService.waitForL2ToL1Message({ intentId });
    yield { step: 3, status: 'complete' };

    // Step 4: Approve USDC spending (if needed)
    yield { step: 4, status: 'approving_usdc' };
    // ... approve logic

    // Step 5: Execute deposit on L1
    yield { step: 5, status: 'executing_l1_deposit' };
    const { txHash: l1TxHash, shares } = await this.portalService.executeDeposit({
      intent: buildDepositIntent(intentId, params),
      ...l2Message,
    });
    yield { step: 5, status: 'complete', txHash: l1TxHash, shares };

    // Step 6: Wait for L1→L2 message
    yield { step: 6, status: 'waiting_for_confirmation' };
    const l1Message = await this.messageService.waitForL1ToL2Message({ intentId });

    // Step 7: Finalize deposit on L2
    yield { step: 7, status: 'finalizing_deposit' };
    const { txHash: finalizeTxHash } = await this.aztecService.finalizeDeposit({
      intentId,
      assetId: 1n,
      shares,
      secret,
      messageLeafIndex: l1Message.messageLeafIndex,
    });
    yield { step: 7, status: 'complete', txHash: finalizeTxHash };

    return { intentId, shares };
  }
}
```

### 3.2 Withdraw Flow Orchestrator

**File**: `frontend/src/flows/withdraw.ts`

```typescript
interface WithdrawFlowParams {
  positionNonce: bigint;    // From PositionReceiptNote
  amount: bigint;           // Must equal total shares
  deadlineSeconds: number;
}

class WithdrawFlowOrchestrator {
  async execute(params: WithdrawFlowParams): AsyncGenerator<WithdrawStep> {
    // Step 1: Generate secret
    // Step 2: Request withdraw on L2 (nullifies position note)
    // Step 3: Wait for L2→L1 message
    // Step 4: Execute withdraw on L1 (withdraws from Aave)
    // Step 5: Wait for L1→L2 message
    // Step 6: Finalize withdraw on L2
  }
}
```

---

## 4. State Management Updates

### 4.1 New State Properties

```typescript
interface AppState {
  // ... existing state

  // Active flow tracking
  activeFlow: {
    type: 'deposit' | 'withdraw' | null;
    step: number;
    totalSteps: number;
    status: 'pending' | 'processing' | 'waiting' | 'complete' | 'error';
    intentId: string | null;
    error: string | null;

    // Step-specific data
    secret?: bigint;          // Store temporarily for finalization
    l2BlockNumber?: bigint;
    leafIndex?: bigint;
    siblingPath?: string[];
    shares?: bigint;
  };

  // User positions (from L2 notes)
  positions: PositionDisplay[];
}
```

### 4.2 Position Display

```typescript
interface PositionDisplay {
  nonce: string;            // Intent ID / note nonce
  assetId: string;
  shares: string;           // As string for JSON compatibility
  sharesFormatted: string;  // Human readable
  status: 'active' | 'pending_withdraw' | 'consumed';
  createdAt?: number;
}
```

---

## 5. UI Components Updates

### 5.1 DepositFlow Component

Update to use the flow orchestrator and show real progress:

```typescript
const DEPOSIT_STEPS = [
  { label: 'Generate secret', description: 'Creating authentication secret' },
  { label: 'Request deposit', description: 'Submitting to Aztec L2' },
  { label: 'Wait for message', description: 'L2 block confirmation' },
  { label: 'Approve USDC', description: 'Authorize portal contract' },
  { label: 'Execute on L1', description: 'Depositing to Aave' },
  { label: 'Wait for confirmation', description: 'L1 block confirmation' },
  { label: 'Finalize deposit', description: 'Creating position receipt' },
];
```

### 5.2 WithdrawFlow Component

```typescript
const WITHDRAW_STEPS = [
  { label: 'Generate secret', description: 'Creating authentication secret' },
  { label: 'Request withdraw', description: 'Submitting to Aztec L2' },
  { label: 'Wait for message', description: 'L2 block confirmation' },
  { label: 'Execute on L1', description: 'Withdrawing from Aave' },
  { label: 'Wait for confirmation', description: 'L1 block confirmation' },
  { label: 'Finalize withdraw', description: 'Completing withdrawal' },
];
```

### 5.3 PositionsList Component

Update to fetch real positions from L2:

```typescript
function PositionsList() {
  const { state, actions } = useApp();

  // Fetch positions when L2 wallet connects
  createEffect(() => {
    if (state.wallet.l2Address && state.contracts.l2Wrapper) {
      fetchPositions();
    }
  });

  const fetchPositions = async () => {
    const notes = await aztecService.getPositionNotes(state.wallet.l2Address);
    actions.setPositions(notes.map(formatPosition));
  };

  // ... render positions with withdraw buttons
}
```

---

## 6. SDK Integration

### 6.1 Required Aztec SDK Modules

```typescript
// From @aztec/aztec.js
import { Fr } from '@aztec/foundation/fields';
import { computeSecretHash } from '@aztec/aztec.js/crypto';

// Contract artifact (generated by aztec codegen)
import { AaveWrapperContract } from '@generated/AaveWrapper';
```

### 6.2 Azguard Wallet Integration

The Azguard wallet provides:
- `wallet.sendTransaction()` - Sign and send L2 transactions
- `wallet.getAccounts()` - Get connected accounts
- Contract method calls via the wallet's PXE connection

```typescript
// Example: Calling request_deposit via Azguard
const contract = await AaveWrapperContract.at(contractAddress, wallet);
const tx = await contract.methods
  .request_deposit(asset, amount, decimals, deadline, secretHash)
  .send();
const receipt = await tx.wait();
const intentId = receipt.returnValues[0];
```

---

## 7. Error Handling

### 7.1 Expected Errors

```typescript
const CONTRACT_ERRORS = {
  // L2 Errors
  INTENT_ALREADY_CONSUMED: 'Intent has already been consumed',
  INVALID_SECRET: 'Secret does not match secret hash',
  NOTE_NOT_FOUND: 'Position receipt note not found',
  UNAUTHORIZED: 'Caller is not the position owner',
  INVALID_AMOUNT: 'Withdrawal amount must equal total shares',

  // L1 Errors
  DEADLINE_EXPIRED: 'Deadline has passed',
  DEADLINE_TOO_SHORT: 'Deadline must be at least 5 minutes',
  DEADLINE_TOO_LONG: 'Deadline cannot exceed 24 hours',
  MESSAGE_NOT_FOUND: 'L2 message not found in outbox',
  ALREADY_EXECUTED: 'Intent already executed',
};
```

### 7.2 Retry Logic

```typescript
// Message waiting should have configurable timeout and polling
const MESSAGE_CONFIG = {
  pollInterval: 5000,      // 5 seconds
  timeout: 300000,         // 5 minutes
  maxRetries: 60,
};
```

---

## 8. Testing Checklist

### 8.1 Deposit Flow
- [ ] Generate secret and compute hash correctly
- [ ] Call `request_deposit` via Azguard
- [ ] Wait for L2 block inclusion
- [ ] Fetch merkle proof for L2→L1 message
- [ ] Approve USDC for portal (if not already approved)
- [ ] Call `executeDeposit` on portal via MetaMask
- [ ] Wait for L1 block inclusion
- [ ] Fetch merkle proof for L1→L2 message
- [ ] Call `finalize_deposit` via Azguard
- [ ] Verify position note created
- [ ] Update UI with new position

### 8.2 Withdraw Flow
- [ ] Fetch user's position notes
- [ ] Select position to withdraw
- [ ] Generate secret and compute hash
- [ ] Call `request_withdraw` via Azguard
- [ ] Wait for L2 block inclusion
- [ ] Fetch merkle proof for L2→L1 message
- [ ] Call `executeWithdraw` on portal via MetaMask
- [ ] Wait for L1 block inclusion
- [ ] Fetch merkle proof for L1→L2 message
- [ ] Call `finalize_withdraw` via Azguard
- [ ] Verify position note consumed
- [ ] Update UI (remove position)

### 8.3 Edge Cases
- [ ] Handle user rejection (wallet popup)
- [ ] Handle deadline expiry
- [ ] Handle insufficient balance
- [ ] Handle network errors
- [ ] Handle transaction revert
- [ ] Resume interrupted flow (if possible)

---

## 9. Configuration

### 9.1 Constants

```typescript
// Asset configuration
const ASSETS = {
  USDC: {
    id: 1n,
    decimals: 6,
    l1Address: '', // From deployments
    symbol: 'USDC',
  },
};

// Deadline constraints (must match L1 portal)
const DEADLINE = {
  MIN_SECONDS: 5 * 60,      // 5 minutes
  MAX_SECONDS: 24 * 60 * 60, // 24 hours
  DEFAULT_SECONDS: 60 * 60,  // 1 hour
};

// Polling intervals
const POLLING = {
  L2_BLOCK: 4000,           // 4 seconds
  L1_BLOCK: 4000,           // 4 seconds
  MESSAGE_CHECK: 5000,      // 5 seconds
};
```

---

## 10. Dependencies

### 10.1 New Dependencies Needed

```json
{
  "@aztec/aztec.js": "^0.65.0",
  "@aztec/foundation": "^0.65.0",
  "@generated/AaveWrapper": "local"
}
```

### 10.2 Contract Artifacts

The frontend needs access to:
1. **L2 Contract ABI**: Generated by `aztec codegen` → `aztec/generated/AaveWrapper.ts`
2. **L1 Portal ABI**: From `eth/out/AztecAavePortalL1.sol/AztecAavePortalL1.json`

---

## 11. Implementation Priority

### Phase 1: Core Infrastructure
1. Aztec contract service (load contract, basic calls)
2. Crypto utilities (secret generation, hashing)
3. Update state management for flows

### Phase 2: Deposit Flow
1. Request deposit implementation
2. L2→L1 message waiting
3. L1 portal execution
4. L1→L2 message waiting
5. Finalize deposit implementation
6. UI progress updates

### Phase 3: Withdraw Flow
1. Position fetching from L2
2. Request withdraw implementation
3. Message waiting (reuse from deposit)
4. L1 portal withdraw execution
5. Finalize withdraw implementation
6. UI updates

### Phase 4: Polish
1. Error handling and recovery
2. Transaction status tracking
3. Position refresh/sync
4. Loading states and animations
