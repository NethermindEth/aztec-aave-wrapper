# Two-Phase Deposit Flow

## Context

The current `executeDepositFlow` runs all 6 steps in a single blocking operation. Step 4 calls `waitForCheckpointProven()` which polls for ~16 minutes until the L2 block is proven on L1. This blocks the entire UI and is unusable.

**Solution**: Split the deposit into two user-triggered phases:
- **Phase 1** (instant, ~15s): Generate secret + `request_deposit` on L2
- **Phase 2** (user-triggered): Wait for proof + `executeDeposit` on L1 + `finalize_deposit` on L2

Between phases, the UI polls for proof readiness and shows an "Execute on L1" button when ready. This mirrors the existing bridge + claim pattern (`ClaimPendingBridges`).

## Files to Create

### 1. `frontend/src/services/pendingDeposits.ts` — Pending deposit persistence

Stores pending deposit metadata in localStorage (similar to `secrets.ts` pattern).

```typescript
interface PendingDeposit {
  intentId: string;           // From L2 request_deposit result
  amount: string;             // User's gross amount (raw bigint as string)
  netAmount: string;          // After 0.1% fee deduction
  deadline: string;           // L1 timestamp + offset (bigint as string)
  l2BlockNumber: number;      // L2 block containing request_deposit tx
  ownerHash: string;          // Hex, poseidon2([caller, intentId])
  salt: string;               // Hex, poseidon2([caller, secretHash])
  secretHash: string;         // Hex
  originalDecimals: number;   // 6 for USDC
  l2TxHash: string;           // L2 transaction hash
  createdAt: number;          // Date.now()
}
```

Functions:
- `savePendingDeposit(deposit: PendingDeposit): void`
- `getPendingDeposits(): PendingDeposit[]`
- `removePendingDeposit(intentId: string): void`
- `getPendingDeposit(intentId: string): PendingDeposit | null`

Storage key: `"aztec-aave-pending-deposits"`. Plain JSON (not encrypted — no secrets, only public data from L2 tx). The actual secret is already encrypted in `secrets.ts`.

### 2. `frontend/src/flows/depositPhase1.ts` — Phase 1: L2 request

Extracts steps 1-2 from `deposit.ts`. Returns a `PendingDeposit` to be persisted.

```typescript
interface DepositPhase1Result {
  pendingDeposit: PendingDeposit;  // To persist
  intentId: string;
  secret: Fr;
  secretHash: Fr;
}

async function executeDepositPhase1(
  l1Clients: L1Clients,
  l2Context: DepositL2Context,
  config: DepositConfig
): Promise<DepositPhase1Result>
```

Steps:
1. Generate secret pair
2. Get L1 timestamp, compute deadline
3. Call `executeRequestDeposit` on L2
4. Compute ownerHash and salt (same as current deposit.ts lines 373-431)
5. Store secret via `storeSecret()`
6. Save pending deposit via `savePendingDeposit()`
7. Return result

Reuses: `generateSecretPair`, `executeRequestDeposit`, `computeOwnerHash`, `storeSecret`, `poseidon2Hash` (all existing).

### 3. `frontend/src/flows/depositPhase2.ts` — Phase 2: L1 execute + L2 finalize

Takes a `PendingDeposit` and executes steps 3-6.

```typescript
interface DepositPhase2Result {
  intentId: string;
  shares: bigint;
  txHashes: {
    l1Execute?: string;
    l2Finalize?: string;
  };
}

async function executeDepositPhase2(
  l1Clients: L1Clients,
  l1Addresses: DepositL1Addresses,
  l2Context: DepositL2Context,
  pendingDeposit: PendingDeposit
): Promise<DepositPhase2Result>
```

Steps:
1. Reconstruct `depositIntent` from `PendingDeposit` fields
2. Compute L2→L1 message hash (same content hash logic as current deposit.ts lines 464-491)
3. Get message proof via `waitForL2ToL1MessageProof()`
4. Verify checkpoint is proven via `waitForCheckpointProven()` (should succeed quickly since UI polls first)
5. Call `executeDeposit()` on L1
6. Wait for L1→L2 message via `waitForL1ToL2Message()`
7. Call `executeFinalizeDeposit()` on L2
8. Remove pending deposit from localStorage on success

Reuses: `waitForL2ToL1MessageProof`, `waitForCheckpointProven`, `executeDeposit`, `executeFinalizeDeposit`, `getIntentShares`, `computeLeafId`, `hasMessageBeenConsumed` (all existing).

### 4. `frontend/src/services/depositProofPoller.ts` — Proof status checker

Non-blocking checker that polls whether a pending deposit's L2 block is proven.

```typescript
type ProofStatus = 'waiting_for_proof' | 'waiting_for_checkpoint' | 'ready' | 'error';

interface DepositProofStatus {
  intentId: string;
  status: ProofStatus;
  l2BlockNumber: number;
  proofResult?: L2ToL1MessageProofResult;  // Cached when available
  error?: string;
}

async function checkDepositProofStatus(
  node: AztecNodeClient,
  publicClient: PublicClient,
  outboxAddress: string,
  pendingDeposit: PendingDeposit,
  l2SenderAddress: string,
  l1PortalAddress: string
): Promise<DepositProofStatus>
```

Logic:
1. Compute L2→L1 message hash from PendingDeposit fields
2. Try `waitForL2ToL1MessageProof()` with short timeout (5s, 1 poll)
3. If no proof yet → `'waiting_for_proof'`
4. If proof obtained, check `getRootData()` on outbox
5. If checkpoint not proven → `'waiting_for_checkpoint'`
6. If checkpoint proven → `'ready'`

### 5. `frontend/src/app/controller/usePendingDeposits.ts` — SolidJS hook

Follows `useBridge.ts` pattern with auto-polling.

```typescript
interface PendingDepositState {
  deposits: PendingDepositWithStatus[];
  isLoading: boolean;
  executingIntentId: string | null;
  error: string | null;
}

interface PendingDepositWithStatus extends PendingDeposit {
  proofStatus: ProofStatus;
}
```

Features:
- Loads pending deposits from localStorage on mount
- Polls proof status every 30 seconds for each pending deposit
- Provides `handleExecuteDeposit(intentId)` that calls `executeDepositPhase2`
- Auto-refreshes after Phase 1 completes (triggered by position status change)
- `createEffect` watches `state.wallet.l2Address` + `state.contracts.portal` to auto-load

### 6. `frontend/src/components/PendingDeposits.tsx` — UI component

Follows `ClaimPendingBridges.tsx` pattern.

Shows each pending deposit as a card with:
- Amount (USDC formatted)
- Intent ID (truncated)
- Status badge: "Waiting for proof" (yellow) / "Ready" (green) / "Executing..." (blue)
- Time since creation
- "Execute on L1" button (enabled only when `proofStatus === 'ready'`)

### 7. Modifications to existing files

#### `frontend/src/app/controller/useOperations.ts`
- Add `handleDepositPhase1(amount, deadline)` — calls `executeDepositPhase1`, adds position with `IntentStatus.PendingDeposit`
- Add `handleDepositPhase2(intentId)` — calls `executeDepositPhase2`, updates position to `IntentStatus.Confirmed`
- Keep existing `handleDeposit` for now (can be removed later)

#### `frontend/src/app/controller/useAppController.ts`
- Import and compose `usePendingDeposits` hook
- Add `pendingDeposits` state to `AppController` interface
- Add `handleDepositPhase1`, `handleDepositPhase2`, `handleRefreshPendingDeposits` to `actions`

#### `frontend/src/components/DepositFlow.tsx`
- Change `DEPOSIT_STEPS` to only show Phase 1 steps (2 steps: generate secret + request on L2)
- Update `onDeposit` to call `handleDepositPhase1` instead of `handleDeposit`
- Add info text: "After L2 request completes, monitor status in Pending Deposits below"

#### App layout (wherever `ClaimPendingBridges` is rendered)
- Add `PendingDeposits` component below `ClaimPendingBridges`

## Implementation Order

1. `services/pendingDeposits.ts` — data layer (no dependencies)
2. `services/depositProofPoller.ts` — polling logic (depends on 1)
3. `flows/depositPhase1.ts` — Phase 1 flow (depends on 1)
4. `flows/depositPhase2.ts` — Phase 2 flow (depends on 1)
5. `app/controller/usePendingDeposits.ts` — hook (depends on 1, 2)
6. `app/controller/useOperations.ts` — add new handlers (depends on 3, 4)
7. `app/controller/useAppController.ts` — wire up hook (depends on 5, 6)
8. `components/PendingDeposits.tsx` — UI (depends on 5)
9. `components/DepositFlow.tsx` — update for Phase 1 only (depends on 6)
10. Wire PendingDeposits into app layout

## Verification

1. Start devnet: `make devnet-up`
2. Bridge USDC to L2 (existing flow)
3. Initiate deposit — should complete Phase 1 in ~15s and show "Pending Deposits"
4. Wait for "Ready" status badge (~16 min for proof)
5. Click "Execute on L1" — should complete Phase 2 (L1 tx + L2 finalize)
6. Position should appear as "Active" in the positions list
7. Test page refresh between phases — pending deposit should persist
