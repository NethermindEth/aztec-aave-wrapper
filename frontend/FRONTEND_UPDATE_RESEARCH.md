# Frontend Update Research Document

Research document analyzing transaction flow specifications vs current frontend implementation.

## System Overview

The frontend is a SolidJS application that orchestrates privacy-preserving deposit and withdrawal operations across Aztec L2 and Ethereum L1. It coordinates wallet connections, contract interactions, and cross-chain messaging.

**Boundaries:**
- In scope: `frontend/src/` - flows, components, services, store, hooks
- Out of scope: L1/L2 contracts, E2E tests, devnet infrastructure

**Entry points:**
- `src/index.tsx` - Application entry
- `src/App.tsx` - Main component orchestrating deposit/withdraw flows
- `src/flows/deposit.ts` - Deposit flow implementation
- `src/flows/withdraw.ts` - Withdraw flow implementation

---

## Core Components

| Component | Location | Responsibility |
|-----------|----------|----------------|
| App | `src/App.tsx` | Main orchestrator, handles deposit/withdraw callbacks |
| DepositFlow | `src/components/DepositFlow.tsx` | Deposit UI with amount input, deadline selector |
| WithdrawFlow | `src/components/WithdrawFlow.tsx` | Withdraw UI with position selector |
| OperationTabs | `src/components/OperationTabs.tsx` | Tab container for deposit/withdraw |
| PositionsList | `src/components/PositionsList.tsx` | Display user positions |
| StepIndicator | `src/components/StepIndicator.tsx` | Multi-step progress display |

---

## Execution Flows

### Deposit Flow (Spec vs Implementation)

#### Specification (DEPOSIT_TRANSACTION_FLOW.md)

```
PREREQUISITE: Bridge USDC to L2 (separate flow)
├── TX A: Approve TokenPortal for USDC (L1 - MetaMask)
├── TX B: TokenPortal.depositToAztecPrivate() (L1 - MetaMask)
└── TX C: BridgedToken.claim_private() (L2 - Azguard)

DEPOSIT FLOW:
Step 0: Generate secret pair (no signature)
Step 1: request_deposit on L2 - Burns L2 tokens, creates intent
Step 2: Wait for L2→L1 message (~2 blocks)
Step 3: executeDeposit on L1 - Claims from TokenPortal, supplies to Aave
Step 4: Wait for L1→L2 message (~10 blocks)
Step 5: finalize_deposit on L2 - Creates PositionReceiptNote
```

#### Current Implementation (`src/flows/deposit.ts:393-790`)

```
Step 1: Generate secret and prepare parameters
Step 2: Call request_deposit on L2
Step 3: Wait for L2→L1 message
Step 4: Execute deposit on L1 (approve + transfer + execute)
Step 5: Wait for L1→L2 message
Step 6: Call finalize_deposit on L2
```

#### Divergences

| Spec | Implementation | Classification |
|------|----------------|----------------|
| Prerequisite: Bridge USDC to L2 first | User funds portal directly with L1 USDC | **CRITICAL DIVERGENCE** |
| L2 tokens burned by `request_deposit` | L1 USDC transferred to portal | **Different token flow** |
| Fee: 0.1% deducted and sent to treasury | No fee handling in frontend | **Missing feature** |
| `TokenPortal.claim()` by AavePortal | Direct transfer to portal | **Different mechanism** |
| Anyone can execute L1 TX | Relayer wallet executes | Correct (privacy model) |

**Key Finding**: The spec describes a privacy-preserving flow where users burn L2 tokens. The current implementation transfers L1 USDC directly to the portal, which may break the privacy model.

---

### Withdraw Flow (Spec vs Implementation)

#### Specification (WITHDRAW_TRANSACTION_FLOW.md)

```
WITHDRAW FLOW:
Step 0: Generate secret pair (no signature)
Step 1: request_withdraw on L2 - Nullifies ACTIVE note, creates PENDING_WITHDRAW
Step 2: Wait for L2→L1 message (~2 blocks)
Step 3: executeWithdraw on L1 - Withdraws from Aave, deposits to TokenPortal
Step 4: Wait for L1→L2 message (~10 blocks)
Step 5: finalize_withdraw on L2 - Nullifies PENDING_WITHDRAW note
Step 6: BridgedToken.claim_private() - Separate flow to claim L2 tokens
```

#### Current Implementation (`src/flows/withdraw.ts:419-654`)

```
Step 1: Generate secret and prepare parameters
Step 2: Call request_withdraw on L2
Step 3: Wait for L2→L1 message
Step 4: Execute withdraw on L1
Step 5: (Optional) Wait for L1→L2 and finalize_withdraw
```

#### Divergences

| Spec | Implementation | Classification |
|------|----------------|----------------|
| TX #4: Token claim via BridgedToken | Not implemented | **Missing step** |
| Tokens deposited to TokenPortal | Assumed direct to user | **Unclear** |
| Full withdrawal only | Correctly enforced | Aligned |
| Refund flow via `claim_refund()` | Not implemented | **Missing feature** |

---

## Missing Features

### 1. Bridge USDC Prerequisite Flow

**Spec Reference**: DEPOSIT_TRANSACTION_FLOW.md lines 23-31

The spec requires users to bridge USDC to L2 before depositing:
```
TX A: User approves TokenPortal for USDC (L1)
TX B: User calls TokenPortal.depositToAztecPrivate() (L1)
TX C: User claims L2 USDC via BridgedToken (L2)
```

**Current State**: Not implemented. Frontend transfers USDC directly.

**Implementation Required**:
- New `BridgeFlow` component
- `src/flows/bridge.ts` - Bridge orchestration
- UI for prerequisite detection and guidance

---

### 2. Protocol Fee Handling

**Spec Reference**: DEPOSIT_TRANSACTION_FLOW.md lines 271-274

```
FEE_BASIS_POINTS: 10 (0.1%)
BASIS_POINTS_DENOMINATOR: 10000
MIN_DEPOSIT_AMOUNT: 100 tokens
```

**Current State**: No fee display or calculation in UI.

**Implementation Required**:
- `src/utils/fees.ts` - Fee calculation utilities
- Update `DepositFlow.tsx` to display net amount after fee
- Minimum deposit validation

---

### 3. Deposit Cancellation/Refund

**Spec Reference**: DEPOSIT_TRANSACTION_FLOW.md lines 549-576

```
cancel_deposit(intentId, current_time, net_amount)
├── Verifies deadline has passed
├── Mints net_amount back to user via BridgedToken
└── Sets status to CANCELLED
```

**Current State**: Not implemented. `ErrorRecovery.tsx` exists but no cancel flow.

**Implementation Required**:
- `src/flows/cancel.ts` - Cancel deposit flow
- Update `PositionCard.tsx` with cancel button for expired pending deposits
- Add `IntentStatus.CANCELLED` handling

---

### 4. Withdraw Refund Flow

**Spec Reference**: WITHDRAW_TRANSACTION_FLOW.md lines 523-590

```
claim_refund(nonce, current_time)
├── Finds PENDING_WITHDRAW note
├── Creates new ACTIVE note (with new nonce)
└── Restores position
```

**Current State**: Not implemented.

**Implementation Required**:
- `src/flows/refund.ts` - Claim refund flow
- UI for expired withdrawals

---

### 5. Token Claim After Withdraw

**Spec Reference**: WITHDRAW_TRANSACTION_FLOW.md lines 107-111

```
TX #4: TOKEN CLAIM (separate flow via BridgedToken)
- User claims tokens from TokenPortal using secret
- Tokens minted to user's private balance on L2
```

**Current State**: Not implemented. Tokens assumed available after L1 execute.

**Implementation Required**:
- `src/flows/claim.ts` - Token claim flow
- Update withdraw completion to include claim step
- Store secretHash for claim

---

## State Model Gaps

### Intent Status Enum

**Spec Reference**: DEPOSIT_TRANSACTION_FLOW.md lines 617-623

| Status | Value | Spec Description |
|--------|-------|------------------|
| UNKNOWN | 0 | Intent not submitted |
| PENDING_DEPOSIT | 1 | Awaiting L1 execution |
| CONFIRMED | 2 | Successfully executed |
| FAILED | 3 | Execution failed |
| PENDING_WITHDRAW | 4 | Withdrawal requested |
| CANCELLED | 5 | Deposit cancelled after deadline |

**Current State** (`src/types/index.ts`):
```ts
// [INFERRED] Only these statuses are actively used:
- PendingDeposit
- Active  // Maps to CONFIRMED
- PendingWithdraw
- Consumed
```

**Missing**: `CANCELLED`, `FAILED`, `UNKNOWN` status handling.

---

### Deadline Tracking

**Spec Reference**: DEPOSIT_TRANSACTION_FLOW.md lines 596-609

```
L1 Deadline Validation:
- MIN_DEADLINE: 5 minutes
- MAX_DEADLINE: 24 hours
```

**Current State** (`src/config/constants.ts`):
```ts
DEADLINE_CONSTRAINTS: {
  MIN_OFFSET_SECONDS: 1800,  // 30 min (spec: 5 min)
  MAX_OFFSET_SECONDS: 86400, // 24 hours (matches spec)
  DEFAULT_OFFSET_SECONDS: 3600,
}
```

**Divergence**: Frontend minimum is 30 minutes, spec allows 5 minutes.

---

## UI Step Configuration Gaps

### Deposit Steps

**Spec** (6 transactions):
```
0. Generate secret (no TX)
1. request_deposit (L2 - User signs)
2. Wait L2→L1
3. executeDeposit (L1 - Relayer signs)
4. Wait L1→L2
5. finalize_deposit (L2 - User signs)
```

**Current** (`src/components/DepositFlow.tsx:23-54`):
```ts
const DEPOSIT_STEPS = [
  "Generate secret",           // Step 0
  "Request deposit on L2",     // Step 1
  "Wait for L2→L1 message",    // Step 2
  "Fund portal with USDC",     // NOT IN SPEC - direct transfer
  "Execute deposit on L1",     // Step 3
  "Finalize deposit on L2",    // Step 5
];
```

**Missing**: "Wait for L1→L2 message" step (Step 4).

### Withdraw Steps

**Spec** (5 transactions + token claim):
```
0. Generate secret (no TX)
1. request_withdraw (L2 - User signs)
2. Wait L2→L1
3. executeWithdraw (L1 - Relayer signs)
4. Wait L1→L2
5. finalize_withdraw (L2 - User signs)
6. claim_private (L2 - Separate flow)
```

**Current** (`src/components/WithdrawFlow.tsx:21-42`):
```ts
const WITHDRAW_STEPS = [
  "Request withdrawal on L2",
  "Wait for L2→L1 message",
  "Execute withdrawal on L1",
  "Finalize withdrawal on L2",
];
```

**Missing**: Token claim step, though noted as optional in spec.

---

## Privacy Model Verification

### Spec Requirements (DEPOSIT_TRANSACTION_FLOW.md lines 486-522)

1. **L2 Token Burn**: User's L2 tokens burned privately - no L1 transfer from user wallet
2. **ownerHash**: `poseidon2_hash([userL2Address])` - L1 never sees actual L2 address
3. **Anyone-can-execute**: TX #2 can be executed by anyone - user's L1 wallet not linked
4. **TokenPortal claim**: Tokens come from TokenPortal, not user's L1 wallet
5. **PositionReceiptNote encrypted**: Only owner can read position data

### Current Implementation Analysis

| Requirement | Status | Location |
|-------------|--------|----------|
| L2 Token Burn | **VIOLATED** | `deposit.ts:504-511` - transfers L1 USDC directly |
| ownerHash computed | Correct | `deposit.ts:429-432` - uses `computeOwnerHash` |
| Relayer executes L1 | Correct | `deposit.ts:634` - uses `relayerWallet` |
| TokenPortal claim | **NOT USED** | Direct transfer instead |
| Encrypted notes | Correct | L2 contract handles this |

**Critical**: Current flow transfers L1 USDC from user wallet to portal, potentially linking user's L1 identity to the deposit.

---

## Implementation Priority

### P0 - Critical (Privacy Impact)

1. **Bridge USDC Flow** - Required for privacy model
   - Files: New `src/flows/bridge.ts`, `src/components/BridgeFlow.tsx`
   - Effort: New flow orchestration + UI

2. **Remove Direct L1 Transfer** - Privacy violation
   - Files: `src/flows/deposit.ts:493-511`
   - Effort: Remove approve/transfer, rely on TokenPortal claim

### P1 - High (Missing Core Features)

3. **Cancel Deposit Flow** - Handle expired intents
   - Files: New `src/flows/cancel.ts`
   - Effort: New flow + UI integration

4. **Token Claim After Withdraw** - Complete withdraw flow
   - Files: New `src/flows/claim.ts`
   - Effort: New flow + secret storage

5. **Protocol Fee Display** - User transparency
   - Files: `src/components/DepositFlow.tsx`
   - Effort: Add fee calculation and display

### P2 - Medium (UX Improvements)

6. **Missing Wait Step in UI** - Step accuracy
   - Files: `src/components/DepositFlow.tsx:23-54`
   - Effort: Add "Wait for L1→L2 message" step

7. **Claim Refund Flow** - Handle expired withdrawals
   - Files: New `src/flows/refund.ts`
   - Effort: New flow + position status handling

8. **Intent Status Expansion** - Full status handling
   - Files: `src/types/state.ts`
   - Effort: Add CANCELLED, FAILED states

### P3 - Low (Refinements)

9. **Deadline Minimum Adjustment** - Match spec
   - Files: `src/config/constants.ts`
   - Effort: Change MIN_OFFSET to 300 seconds

10. **Minimum Deposit Validation** - Match spec
    - Files: `src/components/DepositFlow.tsx`
    - Effort: Add 100 token minimum check

---

## Data Flow Diagram

### Current (Privacy-Violating)

```
L1 User Wallet ──USDC approve+transfer──► Portal ──supply──► Aave
                    ↓ (L1 address exposed)
```

### Spec (Privacy-Preserving)

```
L1 User Wallet ──bridge──► TokenPortal ──────────────────────────────┐
                              ↓ L1→L2 message                        │
L2 User Balance ←───────── BridgedToken mints                        │
       │                                                              │
       └──burn (request_deposit)──► L2→L1 message                    │
                                        ↓                             │
                TokenPortal ←───claim───┘ (AavePortal authorized)     │
                     └──supply──► Aave                                │
```

---

## File Change Summary

| File | Changes Required | Priority |
|------|------------------|----------|
| `src/flows/deposit.ts` | Remove L1 approve/transfer, integrate bridge | P0 |
| `src/flows/bridge.ts` | NEW - Bridge USDC flow | P0 |
| `src/components/BridgeFlow.tsx` | NEW - Bridge UI | P0 |
| `src/flows/cancel.ts` | NEW - Cancel deposit flow | P1 |
| `src/flows/claim.ts` | NEW - Token claim flow | P1 |
| `src/components/DepositFlow.tsx` | Add fee display, fix steps | P1/P2 |
| `src/flows/refund.ts` | NEW - Claim refund flow | P2 |
| `src/types/state.ts` | Add CANCELLED, FAILED statuses | P2 |
| `src/config/constants.ts` | Adjust MIN_DEADLINE | P3 |

---

## Open Questions

- [UNCLEAR] Is the TokenPortal already deployed and configured in devnet?
- [UNCLEAR] Does BridgedToken contract exist and is it deployed?
- [INFERRED] Current flow may be intentional for devnet simplicity but violates prod privacy
- [UNCLEAR] Should bridge flow be a separate page or integrated into deposit?

---

## References

- Deposit Flow Spec: `docs/DEPOSIT_TRANSACTION_FLOW.md`
- Withdraw Flow Spec: `docs/WITHDRAW_TRANSACTION_FLOW.md`
- Frontend Flows: `frontend/src/flows/`
- Components: `frontend/src/components/`
- Store/State: `frontend/src/store/`, `frontend/src/types/`
