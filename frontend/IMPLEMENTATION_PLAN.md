# Frontend Privacy-Preserving Flow Implementation Plan

This plan addresses the divergences between the specification and current implementation, prioritizing privacy-critical fixes first.

---

## Phase 1: Intent Status Expansion and Fee Constants **COMPLETE**

Establish foundational data models and constants before implementing features that depend on them.

### Phase Validation
```bash
cd frontend && npm run build
```

### Step 1: Expand IntentStatus enum in shared types **COMPLETE**

#### Goal
Add CANCELLED, FAILED, and UNKNOWN statuses to match the specification (DEPOSIT_TRANSACTION_FLOW.md lines 617-623).

#### Files
- `shared/src/types.ts` - Add UNKNOWN=0, CANCELLED=5, FAILED=6 to IntentStatus enum, renumber existing values

#### Validation
```bash
grep -q "CANCELLED" shared/src/types.ts && grep -q "FAILED" shared/src/types.ts && echo "OK"
```

#### Failure modes
- Existing code may expect old enum values - requires updating all usages
- Build errors if enum values conflict

---

### Step 2: Add protocol fee constants **COMPLETE**

#### Goal
Create fee configuration constants matching spec (0.1% fee, 100 token minimum).

#### Files
- `frontend/src/config/constants.ts` - Add FEE_CONFIG object with BASIS_POINTS=10, DENOMINATOR=10000, MIN_DEPOSIT=100

#### Validation
```bash
grep -q "FEE_CONFIG" frontend/src/config/constants.ts && echo "OK"
```

#### Failure modes
- Constants imported incorrectly in dependent files

---

### Step 3: Update deadline minimum to match spec **COMPLETE**

#### Goal
Change MIN_OFFSET_SECONDS from 30 minutes to 5 minutes to match L1 spec (DEPOSIT_TRANSACTION_FLOW.md line 605).

#### Files
- `frontend/src/config/constants.ts` - Change MIN_OFFSET_SECONDS from 1800 to 300

#### Validation
```bash
grep "MIN_OFFSET_SECONDS.*300" frontend/src/config/constants.ts && echo "OK"
```

#### Failure modes
- Users may set deadlines too short for L2 processing

---

### Step 4: Add fee calculation utilities **COMPLETE**

#### Goal
Create utility functions to calculate protocol fee and net amount.

#### Files
- `frontend/src/utils/fees.ts` - NEW: Create calculateFee(), calculateNetAmount(), validateMinDeposit() functions

#### Validation
```bash
test -f frontend/src/utils/fees.ts && echo "OK"
```

#### Failure modes
- Precision loss in fee calculations - use bigint arithmetic
- Rounding errors accumulating

---

## Phase 2: Bridge Flow Infrastructure **COMPLETE**

Create the prerequisite bridge flow that moves USDC from L1 to L2 via TokenPortal, which is required for the privacy-preserving architecture.

### Phase Validation
```bash
cd frontend && npm run build && npm run typecheck
```

### Step 5: Add BridgedToken service for L2 token operations **COMPLETE**

#### Goal
Create service to interact with the BridgedToken contract on L2 for claim_private operations.

#### Files
- `frontend/src/services/l2/bridgedToken.ts` - NEW: Create claim_private(), getBalance() functions

#### Validation
```bash
test -f frontend/src/services/l2/bridgedToken.ts && echo "OK"
```

#### Failure modes
- BridgedToken contract ABI mismatch
- Secret handling for claim operation incorrect

---

### Step 6: Add TokenPortal service for L1 bridge operations **COMPLETE**

#### Goal
Create service to interact with TokenPortal contract on L1 for depositToAztecPrivate.

#### Files
- `frontend/src/services/l1/tokenPortal.ts` - NEW: Create depositToAztecPrivate(), getBalance() functions with ABI

#### Validation
```bash
test -f frontend/src/services/l1/tokenPortal.ts && echo "OK"
```

#### Failure modes
- TokenPortal address not available in deployment config
- Incorrect message hash computation for L1→L2

---

### Step 7: Create bridge flow orchestrator **COMPLETE**

#### Goal
Implement the bridge flow that transfers USDC from L1 to L2 (prerequisite for privacy-preserving deposit).

#### Files
- `frontend/src/flows/bridge.ts` - NEW: Create executeBridgeFlow() with 3 steps: approve, depositToAztecPrivate, claim_private

#### Validation
```bash
test -f frontend/src/flows/bridge.ts && grep -q "executeBridgeFlow" frontend/src/flows/bridge.ts && echo "OK"
```

#### Failure modes
- L1→L2 message timing issues
- Secret pair not properly stored between L1 and L2 steps

---

### Step 8: Create BridgeFlow UI component **COMPLETE**

#### Goal
Create UI component for bridging USDC from L1 to L2 before deposit.

#### Files
- `frontend/src/components/BridgeFlow.tsx` - NEW: Create form with amount input, step indicator, 3-step progress display

#### Validation
```bash
test -f frontend/src/components/BridgeFlow.tsx && echo "OK"
```

#### Failure modes
- Component styling inconsistent with existing design
- Form validation edge cases

---

### Step 9: Add bridge configuration to state **COMPLETE**

#### Goal
Add L2 token balance tracking and TokenPortal address to application state.

#### Files
- `frontend/src/types/state.ts` - Add l2UsdcBalance to WalletState, tokenPortal to L1Addresses

#### Validation
```bash
grep -q "l2UsdcBalance" frontend/src/types/state.ts && grep -q "tokenPortal" frontend/src/types/state.ts && echo "OK"
```

#### Failure modes
- State shape change breaks existing components

---

## Phase 3: Update Deposit Flow for Privacy **COMPLETE**

Remove direct L1 USDC transfer and integrate with burn-based privacy model.

### Phase Validation
```bash
cd frontend && npm run build && npm run typecheck
```

### Step 10: Remove L1 approve and transfer from deposit flow **COMPLETE**

#### Goal
Remove the privacy-violating direct USDC transfer from user's L1 wallet (deposit.ts lines 492-511).

#### Files
- `frontend/src/flows/deposit.ts` - Remove approve() and transfer() calls in Step 4, update comments to reflect new flow

#### Validation
```bash
! grep -q "approve.*mockUsdc" frontend/src/flows/deposit.ts && echo "OK"
```

#### Failure modes
- Portal may not receive tokens without direct transfer in devnet - requires TokenPortal claim integration

---

### Step 11: Integrate TokenPortal claim into deposit L1 execution **COMPLETE**

#### Goal
Update executeDeposit to rely on portal claiming from TokenPortal instead of direct user transfer.

#### Files
- `frontend/src/flows/deposit.ts` - Update Step 4 to verify TokenPortal has bridged tokens, remove transfer logic
- `frontend/src/services/l1/portal.ts` - Add check that portal is authorized to claim from TokenPortal

#### Validation
```bash
grep -q "TokenPortal" frontend/src/flows/deposit.ts && echo "OK"
```

#### Failure modes
- TokenPortal claim authorization not configured
- Amount mismatch between burn and claim

---

### Step 12: Add fee display to DepositFlow component **COMPLETE**

#### Goal
Display protocol fee and net amount after fee in the deposit UI.

#### Files
- `frontend/src/components/DepositFlow.tsx` - Add fee calculation display, show gross amount, fee (0.1%), and net amount

#### Validation
```bash
grep -q "fee" frontend/src/components/DepositFlow.tsx && echo "OK"
```

#### Failure modes
- Fee display confusing to users
- Calculation not matching backend

---

### Step 13: Add minimum deposit validation **COMPLETE**

#### Goal
Enforce 100 token minimum deposit as per spec (DEPOSIT_TRANSACTION_FLOW.md line 273).

#### Files
- `frontend/src/components/DepositFlow.tsx` - Add validateAmount check for MIN_DEPOSIT_AMOUNT (100 * 10^6 for USDC)

#### Validation
```bash
grep -q "MIN_DEPOSIT" frontend/src/components/DepositFlow.tsx && echo "OK"
```

#### Failure modes
- Minimum may be different for different token decimals

---

### Step 14: Fix deposit step configuration **COMPLETE**

#### Goal
Update DEPOSIT_STEPS to match spec - remove "Fund portal with USDC" step, add "Wait for L1→L2 message" step.

#### Files
- `frontend/src/components/DepositFlow.tsx` - Update DEPOSIT_STEPS array: remove step 4 "Fund portal", add "Wait for L1→L2" between execute and finalize

#### Validation
```bash
grep -q "Wait for L1→L2" frontend/src/components/DepositFlow.tsx && ! grep -q "Fund portal" frontend/src/components/DepositFlow.tsx && echo "OK"
```

#### Failure modes
- Step counts mismatch between flow and UI

---

## Phase 4: Cancel Deposit Flow **COMPLETE**

Implement deposit cancellation for expired intents.

### Phase Validation
```bash
cd frontend && npm run build && npm run typecheck
```

### Step 15: Create cancel deposit flow orchestrator **COMPLETE**

#### Goal
Implement cancel_deposit flow for reclaiming tokens when deadline passes without L1 execution.

#### Files
- `frontend/src/flows/cancel.ts` - NEW: Create executeCancelDeposit() that calls L2 cancel_deposit()

#### Validation
```bash
test -f frontend/src/flows/cancel.ts && grep -q "executeCancelDeposit" frontend/src/flows/cancel.ts && echo "OK"
```

#### Failure modes
- Time validation mismatch between frontend and contract
- Net amount mismatch on cancellation

---

### Step 16: Add cancel deposit L2 operation **COMPLETE**

#### Goal
Add service function to call cancel_deposit on AaveWrapper contract.

#### Files
- `frontend/src/services/l2/operations.ts` - Add executeCancelDeposit() function with current_time and net_amount params

#### Validation
```bash
grep -q "executeCancelDeposit" frontend/src/services/l2/operations.ts && echo "OK"
```

#### Failure modes
- current_time parameter not accurate enough
- Transaction simulation failures

---

### Step 17: Add cancel button to pending deposits **COMPLETE**

#### Goal
Show cancel option for deposits that have passed their deadline.

#### Files
- `frontend/src/components/PositionCard.tsx` - Add cancel button when status is PendingDeposit and deadline has passed
- `frontend/src/components/PositionsList.tsx` - Pass onCancel callback prop

#### Validation
```bash
grep -q "onCancel" frontend/src/components/PositionsList.tsx && echo "OK"
```

#### Failure modes
- Deadline check needs L1 timestamp, not local time
- UI state not updated after cancel

---

### Step 18: Wire cancel flow to App component **COMPLETE**

#### Goal
Connect cancel deposit functionality to main application.

#### Files
- `frontend/src/App.tsx` - Add handleCancelDeposit callback, pass to PositionsList

#### Validation
```bash
grep -q "handleCancelDeposit" frontend/src/App.tsx && echo "OK"
```

#### Failure modes
- Position not removed from store after cancel
- Balance not refreshed after cancel

---

## Phase 5: Token Claim After Withdraw **COMPLETE**

Complete the withdrawal flow with token claim from TokenPortal.

### Phase Validation
```bash
cd frontend && npm run build && npm run typecheck
```

### Step 19: Add L2 token claim service function **COMPLETE**

#### Goal
Create function to claim tokens from TokenPortal on L2 using BridgedToken.claim_private.

#### Files
- `frontend/src/services/l2/bridgedToken.ts` - Add claimPrivate() function that consumes L1→L2 message

#### Validation
```bash
grep -q "claimPrivate" frontend/src/services/l2/bridgedToken.ts && echo "OK"
```

#### Failure modes
- Secret not stored from withdrawal initiation
- Message leaf index incorrect

---

### Step 20: Create token claim flow orchestrator **COMPLETE**

#### Goal
Implement flow for claiming tokens after withdrawal executes on L1.

#### Files
- `frontend/src/flows/claim.ts` - NEW: Create executeTokenClaim() that waits for L1→L2 message and calls claim_private

#### Validation
```bash
test -f frontend/src/flows/claim.ts && grep -q "executeTokenClaim" frontend/src/flows/claim.ts && echo "OK"
```

#### Failure modes
- Message not yet available when claim attempted
- Secret hash mismatch

---

### Step 21: Store withdrawal secret for claim **COMPLETE**

#### Goal
Persist withdrawal secret so user can claim tokens later.

#### Files
- `frontend/src/services/secrets.ts` - Add storeWithdrawSecret(), getWithdrawSecret() using localStorage or secure storage

#### Validation
```bash
grep -q "storeWithdrawSecret" frontend/src/services/secrets.ts && echo "OK"
```

#### Failure modes
- Secret lost if user clears storage
- Security of secret storage

---

### Step 22: Update withdraw flow to persist secret **COMPLETE**

#### Goal
Modify withdraw flow to store the secret for later token claim.

#### Files
- `frontend/src/flows/withdraw.ts` - After executeWithdraw on L1, call storeWithdrawSecret() with intent ID and secret

#### Validation
```bash
grep -q "storeWithdrawSecret" frontend/src/flows/withdraw.ts && echo "OK"
```

#### Failure modes
- Storage fails silently
- Secret not associated with correct intent

---

### Step 23: Add claim step to WithdrawFlow UI **COMPLETE**

#### Goal
Add token claim step to withdrawal UI and show pending claims.

#### Files
- `frontend/src/components/WithdrawFlow.tsx` - Add WITHDRAW_STEPS entry for "Claim tokens on L2", add claim button for pending withdrawals

#### Validation
```bash
grep -q "Claim tokens" frontend/src/components/WithdrawFlow.tsx && echo "OK"
```

#### Failure modes
- Claim step shown when not applicable
- Step count mismatch

---

## Phase 6: Withdraw Refund Flow **COMPLETE**

Implement refund for expired withdrawal requests.

### Phase Validation
```bash
cd frontend && npm run build && npm run typecheck
```

### Step 24: Add claim_refund L2 operation **COMPLETE**

#### Goal
Add service function to call claim_refund on AaveWrapper contract.

#### Files
- `frontend/src/services/l2/operations.ts` - Add executeClaimRefund() function with nonce and current_time params

#### Validation
```bash
grep -q "executeClaimRefund" frontend/src/services/l2/operations.ts && echo "OK"
```

#### Failure modes
- Nonce parameter format incorrect
- Time validation fails

---

### Step 25: Create refund flow orchestrator **COMPLETE**

#### Goal
Implement claim_refund flow for restoring position when withdrawal expires.

#### Files
- `frontend/src/flows/refund.ts` - NEW: Create executeClaimRefund() that calls L2 claim_refund()

#### Validation
```bash
test -f frontend/src/flows/refund.ts && grep -q "executeClaimRefund" frontend/src/flows/refund.ts && echo "OK"
```

#### Failure modes
- New note nonce not tracked correctly
- Position state not updated after refund

---

### Step 26: Add refund button to pending withdrawals **COMPLETE**

#### Goal
Show refund option for withdrawals that have passed their deadline.

#### Files
- `frontend/src/components/PositionsList.tsx` - Add refund button when status is PendingWithdraw and deadline has passed
- `frontend/src/App.tsx` - Add handleClaimRefund callback

#### Validation
```bash
grep -q "handleClaimRefund" frontend/src/App.tsx && echo "OK"
```

#### Failure modes
- Deadline calculation incorrect
- Position status not reverted to Active after refund

---

## Phase 7: Integration and Tab Navigation

Wire all new flows into the main application with proper navigation.

### Phase Validation
```bash
cd frontend && npm run build && npm run typecheck
```

### Step 27: Add Bridge tab to OperationTabs **COMPLETE**

#### Goal
Integrate BridgeFlow as a tab in the main operation interface.

#### Files
- `frontend/src/components/OperationTabs.tsx` - Add "Bridge" tab with BridgeFlow component, place before Deposit tab

#### Validation
```bash
grep -q "Bridge" frontend/src/components/OperationTabs.tsx && echo "OK"
```

#### Failure modes
- Tab order confusing to users
- Active tab state management issues

---

### Step 28: Wire bridge flow to App component **COMPLETE**

#### Goal
Connect bridge functionality to main application with proper callbacks.

#### Files
- `frontend/src/App.tsx` - Add handleBridge callback, integrate with OperationTabs, update L2 balance after bridge

#### Validation
```bash
grep -q "handleBridge" frontend/src/App.tsx && echo "OK"
```

#### Failure modes
- Balance not refreshed after bridge completes
- Wallet connection issues for multi-step flow

---

### Step 29: Add L2 balance display to DepositFlow

#### Goal
Show user's L2 USDC balance and validate deposit against L2 balance (not L1).

#### Files
- `frontend/src/components/DepositFlow.tsx` - Update maxBalance to use l2UsdcBalance, add balance display, update validation

#### Validation
```bash
grep -q "l2UsdcBalance" frontend/src/components/DepositFlow.tsx && echo "OK"
```

#### Failure modes
- L2 balance not synced with actual note state
- Decimal handling differences between L1 and L2

---

### Step 30: Update types index to export new types

#### Goal
Export all new types and functions from the types index file.

#### Files
- `frontend/src/types/index.ts` - Export FEE_CONFIG, new IntentStatus values, add comments for new statuses

#### Validation
```bash
grep -q "FEE_CONFIG" frontend/src/types/index.ts && echo "OK"
```

#### Failure modes
- Circular dependencies from new exports

---

## Phase 8: Testing and Documentation

Verify implementation matches specification with integration tests.

### Phase Validation
```bash
cd frontend && npm run build && npm run typecheck && npm run test
```

### Step 31: Add unit tests for fee utilities

#### Goal
Test fee calculation functions for correctness.

#### Files
- `frontend/src/utils/fees.test.ts` - NEW: Test calculateFee, calculateNetAmount, validateMinDeposit

#### Validation
```bash
test -f frontend/src/utils/fees.test.ts && echo "OK"
```

#### Failure modes
- Edge cases not covered (zero amount, max uint128)

---

### Step 32: Update flow documentation comments

#### Goal
Update JSDoc comments in flow files to reflect new privacy-preserving architecture.

#### Files
- `frontend/src/flows/deposit.ts` - Update module-level and function comments to describe burn-based flow
- `frontend/src/flows/withdraw.ts` - Update comments to describe TokenPortal claim step

#### Validation
```bash
grep -q "burn" frontend/src/flows/deposit.ts && grep -q "TokenPortal" frontend/src/flows/withdraw.ts && echo "OK"
```

#### Failure modes
- Documentation outdated after future changes

---

### Step 33: Update README with new flow descriptions

#### Goal
Document the new bridge, cancel, and claim flows in frontend README.

#### Files
- `frontend/README.md` - Add sections for Bridge Flow, Cancel Deposit, Token Claim, with user-facing descriptions

#### Validation
```bash
grep -q "Bridge Flow" frontend/README.md && grep -q "Cancel Deposit" frontend/README.md && echo "OK"
```

#### Failure modes
- Documentation gets out of sync with implementation

---
