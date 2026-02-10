

Let me explore the codebase to understand the existing patterns and file structure before creating the plan.
Now let me read the key reference files in parallel to understand the existing patterns.
Now let me read the remaining key files in parallel.
Let me also check the app layout and BusyState to understand where components are rendered.
Now let me read the types/state.ts to understand the state shape and IntentStatus.
Now I have a thorough understanding of the codebase. Let me produce the structured implementation plan.

## Phase 1: Data Layer — Pending Deposit Persistence **COMPLETE**

Create the localStorage-based persistence service for pending deposits, following the `secrets.ts` pattern.

### Phase Validation
```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20
```

### Step 1: Create `pendingDeposits.ts` service **COMPLETE**

#### Goal
Create a plain JSON localStorage service for storing pending deposit metadata between Phase 1 and Phase 2. Follows the same pattern as `secrets.ts` (lines 181-212) but without encryption since pending deposit data is all public.

#### Files
- `frontend/src/services/pendingDeposits.ts` — New file. Define `PendingDeposit` interface and CRUD functions: `savePendingDeposit`, `getPendingDeposits`, `getPendingDeposit`, `removePendingDeposit`

#### Validation
```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | grep -c "error" | xargs test 0 -eq && echo "OK"
```

#### Failure modes
- Name collision with existing `services/pendingBridges.ts` — use distinct storage key `"aztec-aave-pending-deposits"`
- BigInt serialization — store all bigint values as strings (matches `PositionDisplay` pattern in `types/state.ts:88-103`)

---

## Phase 2: Flow Logic — Split Deposit into Two Phases

Extract the existing `executeDepositFlow` (`flows/deposit.ts:303-676`) into two independent phase functions.

### Phase Validation
```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20
```

### Step 2: Create `depositPhase1.ts` flow **COMPLETE**

#### Goal
Extract steps 1-2 from `executeDepositFlow` (lines 324-382) into a standalone Phase 1 function. This covers: secret generation, L1 timestamp fetch, `executeRequestDeposit` call, owner hash computation, secret storage, and pending deposit persistence. Returns a `DepositPhase1Result` with the `PendingDeposit` to persist.

#### Files
- `frontend/src/flows/depositPhase1.ts` — New file. Import types from `deposit.ts` (`DepositL1Addresses`, `DepositL2Context`, `DepositConfig`). Reuse: `generateSecretPair` (crypto.ts), `executeRequestDeposit` (operations.ts), `computeOwnerHash` (crypto.ts), `storeSecret` (secrets.ts), `savePendingDeposit` (pendingDeposits.ts). Store operation tracking via `startOperation`/`setOperationStep`/`clearOperation` (store/actions.ts).

#### Validation
```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | grep -c "error" | xargs test 0 -eq && echo "OK"
```

#### Failure modes
- Missing re-exports from `deposit.ts` — the new file imports shared types, ensure they are exported
- `poseidon2Hash` import path — must match existing usage at `deposit.ts:422` (`@aztec/foundation/crypto/poseidon`)
- Fee computation must match L2 contract: `fee = amount * 10 / 10000` (line 430-431 of deposit.ts)

---

### Step 3: Create `depositPhase2.ts` flow **COMPLETE**

#### Goal
Extract steps 3-6 from `executeDepositFlow` (lines 386-636) into a standalone Phase 2 function. Takes a `PendingDeposit` and executes: L2→L1 message hash computation, proof fetching, checkpoint proving, L1 `executeDeposit`, L1→L2 message wait, L2 `finalize_deposit`, and pending deposit cleanup.

#### Files
- `frontend/src/flows/depositPhase2.ts` — New file. Reconstruct `depositIntent` from `PendingDeposit` fields. Reuse: `waitForL2ToL1MessageProof`, `waitForCheckpointProven`, `executeDeposit` (l1/portal.ts), `waitForL1ToL2Message` (extracted as a shared helper or duplicated), `executeFinalizeDeposit` (l2/operations.ts), `removePendingDeposit` (pendingDeposits.ts). Import `computeL2ToL1MessageHash` from `@aztec/stdlib/hash`, `sha256ToField` and `bigIntToBytes32` from `l2/crypto.ts`.

#### Validation
```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | grep -c "error" | xargs test 0 -eq && echo "OK"
```

#### Failure modes
- `waitForL1ToL2Message` is a private function in `deposit.ts` (line 166) — must either export it or duplicate it in `depositPhase2.ts`
- Content hash field order must match exactly (lines 464-473 of deposit.ts): `[intentId, ownerHash, asset, netAmount, originalDecimals, deadline, salt, secretHash]`
- `PendingDeposit` stores strings — must convert back to bigint/Fr correctly

---

## Phase 3: Proof Polling Service

Create the non-blocking proof status checker that the UI will use to poll.

### Phase Validation
```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20
```

### Step 4: Create `depositProofPoller.ts` service

#### Goal
Create a single-shot async function `checkDepositProofStatus` that checks whether a pending deposit's L2 block has been proven on L1. Returns a status enum: `'waiting_for_proof'`, `'waiting_for_checkpoint'`, `'ready'`, or `'error'`. This is called by the UI hook on a 30-second interval.

#### Files
- `frontend/src/services/depositProofPoller.ts` — New file. Computes L2→L1 message hash from `PendingDeposit` fields (same logic as `depositPhase2.ts` step 3 content hash computation). Calls `waitForL2ToL1MessageProof` with short timeout (5s, 1 poll). If proof obtained, calls `getRootData` on outbox via `publicClient.readContract` to check checkpoint status (matching `waitForCheckpointProven` pattern at `messageProof.ts:376-417`).

#### Validation
```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | grep -c "error" | xargs test 0 -eq && echo "OK"
```

#### Failure modes
- Redundant message hash computation with `depositPhase2.ts` — consider extracting shared helper, but keep it simple for now (duplicate is acceptable for two call sites)
- Short timeout must not throw — catch timeout and return `'waiting_for_proof'`
- `getRootData` revert must be caught — revert means `'waiting_for_checkpoint'`, not error

---

## Phase 4: Controller Layer — Hook and Operations Wiring

Wire the new flows and poller into the SolidJS controller layer.

### Phase Validation
```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20
```

### Step 5: Create `usePendingDeposits.ts` hook

#### Goal
Create a SolidJS hook following the `useBridge.ts` pattern (lines 68-259). Manages pending deposit state with auto-polling for proof readiness. Provides `handleExecuteDeposit(intentId)` that calls `executeDepositPhase2`.

#### Files
- `frontend/src/app/controller/usePendingDeposits.ts` — New file. Uses `createStore` for `PendingDepositState` (list of deposits with proof status, loading flag, executing intent ID, error). Uses `createEffect` with `on()` to auto-load from localStorage when `state.wallet.l2Address` + `state.contracts.portal` are set (same pattern as `useBridge.ts:203-220`). Sets up `setInterval` for 30-second proof polling via `checkDepositProofStatus`. Provides `handleExecuteDeposit` that calls `executeDepositPhase2` and `handleRefreshPendingDeposits`.

#### Validation
```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | grep -c "error" | xargs test 0 -eq && echo "OK"
```

#### Failure modes
- Interval leak on component unmount — use `onCleanup` to clear interval
- Race condition if user clicks execute while poll is running — use `executingIntentId` guard
- Must not poll when no pending deposits exist — skip polling when list is empty

---

### Step 6: Add Phase 1 and Phase 2 handlers to `useOperations.ts`

#### Goal
Add `handleDepositPhase1` and `handleDepositPhase2` operation handlers to `useOperations`, following the same pattern as existing `handleDeposit` (lines 157-235). Keep existing `handleDeposit` for backward compatibility.

#### Files
- `frontend/src/app/controller/useOperations.ts` — Add `handleDepositPhase1(amount, deadline)` that calls `executeDepositPhase1`, adds position with `IntentStatus.PendingDeposit`. Add `handleDepositPhase2(intentId)` that calls `executeDepositPhase2`, updates position to `IntentStatus.Confirmed`. Add imports for `executeDepositPhase1` and `executeDepositPhase2`. Add to `UseOperationsResult` interface (line 53-71) and return object (line 512-519).

#### Validation
```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | grep -c "error" | xargs test 0 -eq && echo "OK"
```

#### Failure modes
- `BusyState` may not have a key for Phase 2 execution — reuse `depositing` key or add `executingDeposit` to `BusyState` interface in `useBusy.ts`
- Position status enum — `IntentStatus.PendingDeposit` must exist in `@aztec-aave-wrapper/shared`

---

### Step 7: Wire `usePendingDeposits` into `useAppController.ts`

#### Goal
Compose the new `usePendingDeposits` hook into the app controller, exposing pending deposit state and actions to the UI layer.

#### Files
- `frontend/src/app/controller/useAppController.ts` — Import `usePendingDeposits`. Call it in `useAppController()`. Add `pendingDeposits` to `AppController` interface (line 33-68). Add `handleDepositPhase1`, `handleDepositPhase2`, `handleRefreshPendingDeposits` to `actions`. Re-export `PendingDepositState` type.

#### Validation
```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | grep -c "error" | xargs test 0 -eq && echo "OK"
```

#### Failure modes
- Circular dependency — `usePendingDeposits` depends on `useOperations` handlers; resolve by having the hook take phase2 handler as a dependency parameter rather than importing directly

---

## Phase 5: UI Layer — Components and DepositFlow Update

Build the `PendingDeposits` component and update `DepositFlow` to use Phase 1 only.

### Phase Validation
```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20
```

### Step 8: Create `PendingDeposits.tsx` component

#### Goal
Create a UI component following the `ClaimPendingBridges.tsx` pattern (lines 91-184). Shows each pending deposit as a card with amount, intent ID, status badge, time since creation, and an "Execute on L1" button enabled only when proof status is `'ready'`.

#### Files
- `frontend/src/components/PendingDeposits.tsx` — New file. Props: `deposits` (array with proof status), `isLoading`, `executingIntentId`, `error`, `onExecute(intentId)`, `onRefresh()`. Status badge colors: yellow for `waiting_for_proof`/`waiting_for_checkpoint`, green for `ready`, blue for executing. Uses `For`/`Show` from `solid-js`, `Card`/`Button`/`Alert`/`Badge` from `./ui/`. Formats USDC with `formatBalance` from `BalanceDisplay.tsx:13`.

#### Validation
```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | grep -c "error" | xargs test 0 -eq && echo "OK"
```

#### Failure modes
- Import path mismatch for UI components — check exact exports from `./ui/card`, `./ui/button`, `./ui/alert`
- Missing `formatBalance` export — verify it's exported from `BalanceDisplay.tsx`

---

### Step 9: Update `DepositFlow.tsx` for Phase 1 only

#### Goal
Update the `DepositFlow` component to show only Phase 1 steps (2 steps: generate secret + request on L2) instead of the full 6-step flow. Add info text explaining that Phase 2 is monitored in the Pending Deposits section below.

#### Files
- `frontend/src/components/DepositFlow.tsx` — Change `DEPOSIT_STEPS` array (lines 22-53) to only include the first 2 steps. Update `onDeposit` prop type if needed (currently `(amount: bigint, deadlineSeconds: number) => void` at line 72, which already matches Phase 1 signature). Add a `<p>` info text below the step indicator.

#### Validation
```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | grep -c "error" | xargs test 0 -eq && echo "OK"
```

#### Failure modes
- Step count mismatch — `getDepositStepCount()` in `types/operations.ts` returns 5 (from DEPOSIT_STEPS record), but `DepositFlow.tsx` uses its own local `DEPOSIT_STEPS` array. The local array is what matters for the step indicator.
- Existing `handleDeposit` in `useOperations` still references old flow — Phase 1 handler is separate (`handleDepositPhase1`), so `onDeposit` callback in `App.tsx` must be rewired

---

### Step 10: Wire `PendingDeposits` into `App.tsx` layout

#### Goal
Add the `PendingDeposits` component to the main app layout, placed below `ClaimPendingBridges` and above `PositionsList`. Update `onDeposit` callback in `OperationTabs` to use `handleDepositPhase1`.

#### Files
- `frontend/src/App.tsx` — Import `PendingDeposits` component. Add `<PendingDeposits>` section between `ClaimPendingBridges` (line 191-200) and `PositionsList` (line 203-211). Pass props from `controller.pendingDeposits` state and `controller.actions.handleDepositPhase2`/`handleRefreshPendingDeposits`. Update `onDeposit={controller.actions.handleDeposit}` (line 184) to `onDeposit={controller.actions.handleDepositPhase1}`.

#### Validation
```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | grep -c "error" | xargs test 0 -eq && echo "OK"
```

#### Failure modes
- `handleDepositPhase1` has different return type than `handleDeposit` — the `onDeposit` prop type is `(amount: bigint, deadlineSeconds: number) => void` which is compatible
- `controller.pendingDeposits` may not be defined yet if `useAppController` hasn't been updated — must complete Step 7 first

---

## Phase 6: Build Verification

Verify the complete implementation compiles and builds successfully.

### Phase Validation
```bash
cd frontend && bun run build 2>&1 | tail -5
```

### Step 11: Full build and lint check

#### Goal
Run the full build pipeline to verify no compile errors, lint violations, or runtime import issues.

#### Files
- No new files — verification only

#### Validation
```bash
cd frontend && bun run build && bun run check 2>&1 | tail -10
```

#### Failure modes
- Tree-shaking may remove lazy imports (`await import(...)`) — verify Vite config handles dynamic imports
- Biome lint may flag unused variables in intermediate steps — ensure all exports are consumed
- Missing `solid-js/store` imports in new hooks — verify `createStore` import path

---
