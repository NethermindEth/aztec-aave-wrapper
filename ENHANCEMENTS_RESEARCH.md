# Enhancement Research: Withdraw Confirmation Binding & Per-Intent Owner Hash

> **Last Reviewed:** 2026-01-27 against current codebase state

## System Overview

This document analyzes two proposed privacy and security enhancements to the Aztec-Aave wrapper's withdraw flow:

1. **Bind withdraw confirmations to the secret** - Use the same `secretHash` from `request_withdraw` when sending the L1→L2 confirmation
2. **Per-intent owner hash** - Replace `ownerHash = poseidon2(owner)` with `poseidon2(owner, intent_id or salt)` to reduce linkability

**Boundaries:**
- In scope: L2 `request_withdraw`, L1 `executeWithdraw`, L2 finalization/token claiming
- Out of scope: Deposit flow, TokenPortal implementation, Aave interactions

**Entry points:**
- L2: `aztec/aave_wrapper/src/main.nr:767` (`request_withdraw`)
- L1: `eth/contracts/AztecAavePortalL1.sol:286` (`executeWithdraw`)
- L2 Token Claim: `aztec/bridged_token/src/main.nr:269` (`claim_private`)

---

## Core Components

| Component | Location | Responsibility |
|-----------|----------|----------------|
| AaveWrapper (Noir) | `aztec/aave_wrapper/src/main.nr` | L2 withdraw request, note management |
| AztecAavePortalL1 | `eth/contracts/AztecAavePortalL1.sol` | L1 withdraw execution, token bridging |
| TokenPortal | `eth/contracts/TokenPortal.sol` | L1↔L2 token bridging with secretHash |
| WithdrawIntent (Noir) | `aztec/aave_wrapper/src/types/intent.nr:43-53` | L2 withdraw data structure |
| WithdrawIntent (Sol) | `eth/contracts/types/Intent.sol:36-49` | L1 withdraw data structure |
| IntentLib | `eth/contracts/types/Intent.sol:51-147` | Hash computation library |

---

## Data Model

### WithdrawIntent (Noir)
```
Location: aztec/aave_wrapper/src/types/intent.nr:43-53
Fields:
  - intent_id: Field (32 bytes) - position lifecycle identifier
  - owner_hash: Field (32 bytes) - poseidon2(owner)
  - amount: u128 (16 bytes) - shares to withdraw
  - deadline: u64 (8 bytes) - expiration timestamp
```

### WithdrawIntent (Solidity)
```
Location: eth/contracts/types/Intent.sol:36-49
Fields:
  - intentId: bytes32 - same as L2 intent_id
  - ownerHash: bytes32 - same as L2 owner_hash
  - amount: uint128 - shares to withdraw
  - deadline: uint64 - expiration timestamp
```

**Constraints:**
- `amount == receipt.shares` (full withdrawal only) - enforced at `main.nr:796-799`
- Status must be ACTIVE before withdrawal - enforced at `main.nr:793`
- Deadline is enforced on L1 in `executeWithdraw`; L2 does not sanity-check non-zero deadlines in `request_withdraw`

---

## Execution Flows

### Flow: Current Withdraw (Before Enhancement)

```
1. L2 request_withdraw (main.nr:767-843)
   ├─ owner = msg_sender()                                    (line 774)
   ├─ pop_notes with nonce selector                           (line 779-783)
   ├─ assert receipt.status == ACTIVE                         (line 793)
   ├─ assert amount == receipt.shares (full withdraw)         (line 796-799)
   ├─ owner_hash = poseidon2_hash([owner.to_field()])        (line 822)
   ├─ intent = WithdrawIntent::new(...)                       (line 825)
   ├─ content = compute_withdraw_message_content(             (line 829)
   │            intent, asset_id, secret_hash)
   ├─ context.message_portal(portal, content)                 (line 833)
   └─ enqueue _request_withdraw_public                        (line 838-840)

2. L1 executeWithdraw (AztecAavePortalL1.sol:286-362)
   ├─ Check replay protection                                 (line 295-297)
   ├─ Check deadline passed                                   (line 300-302)
   ├─ Validate deadline bounds (5min-24hr)                    (line 305)
   ├─ Retrieve shares from intentShares[intentId]             (line 308-311)
   ├─ intentHash = IntentLib.hashWithdrawIntent(              (line 316)
   │               intent, asset, secretHash)
   ├─ Consume L2→L1 message from outbox                       (line 319-324)
   ├─ Mark consumed, clear shares                             (line 327-331)
   ├─ Withdraw from Aave                                      (line 335-343)
   ├─ TokenPortal.depositToAztecPrivate(                      (line 354-355)
   │   withdrawnAmount, secretHash)
   └─ [NO L1→L2 confirmation message sent]

3. L2 Token Claiming (via BridgedToken - separate from AaveWrapper)
   └─ User claims tokens using `BridgedToken.claim_private` with secret preimage
```

**Key Observations:**
- The current flow does NOT send an L1→L2 confirmation message from `executeWithdraw`. Instead, token claiming is handled entirely through `TokenPortal.depositToAztecPrivate()`, which sends its own L1→L2 message for the BridgedToken contract.
- **Important ordering:** On L1, deadline validation (lines 300-305) happens *before* L2→L1 message consumption (lines 319-324). If validation fails, the L2→L1 message remains unconsumed, allowing retry with a new intent after deadline fixes.

---

## Current Secret Hash Usage

| Phase | Component | Location | Uses secretHash | Purpose |
|-------|-----------|----------|-----------------|---------|
| L2→L1 Message | `compute_withdraw_message_content` | `main.nr:236-283` | Included in hash | Binds withdrawal to specific secret |
| L1 Verification | `IntentLib.hashWithdrawIntent` | `Intent.sol:83-99` | Included in hash | Verifies L2→L1 message authenticity |
| L1→L2 Token Bridge | `TokenPortal.depositToAztecPrivate` | `TokenPortal.sol:176-204` | Passed to inbox | Enables private token claiming |

### Message Content Encoding (L2→L1)

```noir
// Location: main.nr:236-283
// 192-byte buffer encoding:
// Bytes 0-31:    intent_id
// Bytes 32-63:   owner_hash
// Bytes 64-95:   amount
// Bytes 96-127:  deadline
// Bytes 128-159: asset_id
// Bytes 160-191: secret_hash  ← SECRET HASH IS HERE
```

```solidity
// Location: Intent.sol:83-99
function hashWithdrawIntent(
    WithdrawIntent memory intent,
    address asset,
    bytes32 secretHash
) internal pure returns (bytes32) {
    return Hash.sha256ToField(abi.encodePacked(
        intent.intentId,
        intent.ownerHash,
        bytes32(uint256(intent.amount)),
        bytes32(uint256(intent.deadline)),
        bytes32(uint256(uint160(asset))),
        secretHash  // ← SAME SECRET HASH
    ));
}
```

---

## Enhancement 1: Bind Withdraw Confirmations to Secret

### Current State Analysis

**Finding:** The withdraw flow currently does NOT send a separate L1→L2 confirmation message.

Evidence from `AztecAavePortalL1.sol:359-361`:
```solidity
// Note: No L1->L2 confirmation message needed for withdrawals.
// Token claiming via BridgedToken completes the withdrawal flow.
// The PendingWithdraw note on L2 remains for refund capability if needed.
```

The `finalize_withdraw` function was removed from the main contract (see comment at `main.nr:884-886`):
```noir
// Note: finalize_withdraw has been removed. Token claiming via BridgedToken
// completes the withdrawal flow. The PendingWithdraw note remains for refund
// capability if the withdrawal fails (deadline expires without token claim).
```

### Current Token Flow

```
executeWithdraw() on L1
        │
        ├─ Withdraws from Aave
        │
        └─ TokenPortal.depositToAztecPrivate(amount, secretHash)
                │
                ├─ Locks tokens in TokenPortal
                │
                └─ Sends L1→L2 message to BridgedToken
                        │
                        └─ Content: sha256ToField([amount, secretHash])
                           (see TokenPortal.sol:191-192)
```

### [INFERRED] Original Design Intent

The `compute_withdraw_confirmation_content` function exists (`main.nr:186-215`) but is currently unused:

```noir
pub fn compute_withdraw_confirmation_content(
    intent_id: Field,
    asset_id: Field,
    amount: u128,
) -> Field {
    // Encoding: intentId (32) + asset (32) + amount (32) = 96 bytes
    // NOTE: Does NOT include secretHash
}
```

### Enhancement Recommendation

If the system were to add an L1→L2 withdrawal confirmation:

**Option A: Include secretHash in confirmation content**
```noir
// Enhanced compute_withdraw_confirmation_content
pub fn compute_withdraw_confirmation_content(
    intent_id: Field,
    asset_id: Field,
    amount: u128,
    secret_hash: Field,  // NEW: Add secretHash parameter
) -> Field {
    // 128-byte buffer
    let mut data: [u8; 128] = [0; 128];
    // ... pack intent_id, asset_id, amount, secret_hash
}
```

**Option B: Store secretHash on L1 during deposit for cross-referencing**
- Store `secretHash` in a mapping when `executeDeposit` succeeds
- Verify consistency when `executeWithdraw` is called

### Impact Assessment

| Aspect | Current State | After Enhancement |
|--------|---------------|-------------------|
| Token claiming | Bound to secretHash via TokenPortal | No change |
| Confirmation message | Not sent | Would require secretHash if added |
| Authentication | User proves secret knowledge to BridgedToken | Same mechanism |
| Refund capability | PendingWithdraw note remains | No change (refunds do not use secretHash) |

**[UNCLEAR]** Whether adding a separate L1→L2 confirmation is necessary given that token claiming already uses the secretHash mechanism through TokenPortal.

---

## Enhancement 2: Per-Intent Owner Hash

### Current State Analysis

**Current Implementation** (`main.nr:822`):
```noir
let owner_hash = poseidon2_hash([owner.to_field()]);
```

**Problem:** Same owner always produces the same `owner_hash`, enabling intent linkability:
- Observer sees multiple intents with identical `owner_hash`
- Can deduce they belong to the same L2 address
- Cross-references deposits and withdrawals

### Linkability Attack Vector

```
Intent A: owner_hash = poseidon2(Alice)  →  0xABC...
Intent B: owner_hash = poseidon2(Alice)  →  0xABC...  (SAME!)
Intent C: owner_hash = poseidon2(Bob)    →  0xDEF...

Attacker deduces: Intent A and B are from the same user
```

### Enhancement Options

#### Option 1: Use intent_id as salt
```noir
let owner_hash = poseidon2_hash([owner.to_field(), intent_id]);
```

**Pros:**
- Deterministic: same inputs always produce same hash
- No additional storage needed
- L1 can still verify (receives intent_id in message)

**Cons:**
- If intent_id generation is predictable, may leak information
- [INFERRED] intent_id is derived from `poseidon2(caller, asset, net_amount, decimals, deadline, salt)` for deposits (`main.nr:40-48`)
- For withdrawals, intent_id = receipt.nonce (from original deposit)

#### Option 2: Use user-provided salt
```noir
fn request_withdraw(
    nonce: Field,
    amount: u128,
    deadline: u64,
    secret_hash: Field,
    owner_salt: Field,  // NEW: User-provided randomness
) -> pub Field {
    let owner_hash = poseidon2_hash([owner.to_field(), owner_salt]);
    // ...
}
```

**Pros:**
- Maximum unlinkability if salt is truly random
- User controls their privacy level

**Cons:**
- Requires additional parameter
- Salt must be included in L2→L1 message for L1 verification
- User must store/remember salt for refund scenarios

#### Option 3: Derive salt from secret_hash
```noir
let owner_salt = poseidon2_hash([owner.to_field(), secret_hash]);
let owner_hash = poseidon2_hash([owner.to_field(), owner_salt]);
```

**Pros:**
- No additional user input needed
- Salt is deterministic from existing data
- Different secret_hash per intent → different owner_hash

**Cons:**
- [INFERRED] If same secret is reused across intents, linkability returns
- Adds computational overhead

### Cross-Contract Consistency

For consistency, deposits and withdrawals should use a compatible owner_hash scheme:

| Operation | Current owner_hash | Location |
|-----------|-------------------|----------|
| request_deposit | `poseidon2_hash([caller])` | `main.nr:518` |
| request_withdraw | `poseidon2_hash([owner])` | `main.nr:822` |

**Note:** L1 never recomputes `owner_hash`; it hashes the value supplied by L2. A change on one side won't break L1 verification, but consistent derivation helps privacy expectations and off-chain tooling.

### L1 Verification Impact

The L1 portal receives `owner_hash` in the intent and includes it in message verification:

```solidity
// Intent.sol:83-99
function hashWithdrawIntent(
    WithdrawIntent memory intent,  // Contains ownerHash
    address asset,
    bytes32 secretHash
) internal pure returns (bytes32)
```

If `owner_hash` computation changes on L2, the same change must be applied to:
1. L2 `request_withdraw` (`main.nr:822`)
2. L2 `request_deposit` (`main.nr:518`)
3. Any L1 or relayer code that reconstructs the hash (currently none)

**[INFERRED]** L1 does not compute `owner_hash` itself; it receives the value from L2 messages and uses it for verification.

### Recommended Implementation

**Option 1 (intent_id salt) for withdrawals:**

```noir
// main.nr line 822, change from:
let owner_hash = poseidon2_hash([owner.to_field()]);

// To:
let owner_hash = poseidon2_hash([owner.to_field(), intent_id]);
```

**For deposits (main.nr line 518):**

```noir
// IMPORTANT: Requires reordering - salt is currently computed AFTER owner_hash
// Current order:
//   Line 518: let owner_hash = poseidon2_hash([caller.to_field()]);
//   Line 522: let salt = poseidon2_hash([caller.to_field(), secret_hash]);
//
// Must change to:
let salt = poseidon2_hash([caller.to_field(), secret_hash]);  // Move up from line 522
let owner_hash = poseidon2_hash([caller.to_field(), salt]);   // Now uses salt
```

**Rationale:**
- `salt` for deposits and `intent_id` for withdrawals are unique per intent if the user provides a unique `secret_hash`
- No additional parameters needed
- L1 receives full intent with all values needed for verification
- Deterministic: enables audit trails without revealing identity

---

## Invariants

| Invariant | Enforced At | Notes |
|-----------|-------------|-------|
| Full withdrawal only | `main.nr:796-799` | `amount == receipt.shares` |
| Receipt must be ACTIVE | `main.nr:793` | Status check before withdrawal |
| Owner must match | `main.nr:790` | `receipt.owner == owner` |
| Intent must be CONFIRMED | `main.nr:862` | Public state check |
| Deadline not passed | `AztecAavePortalL1.sol:300-302` | `block.timestamp < deadline` |
| Deadline within bounds | `AztecAavePortalL1.sol:305` | 5 min - 24 hr via `_validateDeadline()` |
| Shares must exist | `AztecAavePortalL1.sol:308-311` | From prior deposit |
| No replay | `AztecAavePortalL1.sol:295-297` | `consumedWithdrawIntents` mapping |

---

## Failure Modes

| Failure | Trigger | Behavior | Location |
|---------|---------|----------|----------|
| Note not found | Invalid nonce | Revert "Position receipt note not found" | `main.nr:786` |
| Not owner | Caller mismatch | Revert "Not the owner of this position" | `main.nr:790` |
| Not active | Wrong status | Revert "Position is not active" | `main.nr:793` |
| Partial withdrawal | amount != shares | Revert "Must withdraw full position" | `main.nr:796-799` |
| Intent not confirmed | Wrong L2 status | Revert "Intent not in confirmed state" | `main.nr:862` |
| Replay attack | Already consumed | Revert `IntentAlreadyConsumed` | `AztecAavePortalL1.sol:295-297` |
| Deadline passed | Expired | Revert `DeadlinePassed` | `AztecAavePortalL1.sol:300-302` |
| No shares | Never deposited | Revert `NoSharesForIntent` | `AztecAavePortalL1.sol:308-311` |

---

## Open Questions (Code-Only)

1. **[CODE]** `compute_withdraw_confirmation_content` is unused while `finalize_withdraw` is removed. Should this function be removed or repurposed for a future confirmation path?

   **Analysis:** The function is imported at `main.nr:305` but never called. It represents dead code.

   **Recommendation:** Remove the function to reduce contract size and avoid confusion, OR add a `// TODO: Reserved for future L1→L2 confirmation path` comment if this is intentionally preserved for future use.

2. **[CODE]** `request_withdraw` does not validate `deadline > 0` on L2. Is that acceptable, or should L2 add the same sanity check as `request_deposit` to prevent `deadline=0` intents from getting stuck?

   **Analysis:** This is an **actual inconsistency** in the codebase:
   - `request_deposit` at line 506: `assert(deadline > 0, "Deadline must be greater than zero");`
   - `request_withdraw`: **No such check exists**

   A `deadline=0` withdraw intent would:
   1. Pass all L2 checks
   2. Fail on L1 at line 300 (`block.timestamp >= 0` is always true → `DeadlinePassed`)
   3. Leave the user with a stuck `PendingWithdraw` note that cannot be executed
   4. User would need to wait for refund flow (if implemented)

   **Recommendation:** Add `assert(deadline > 0, "Deadline must be greater than zero");` to `request_withdraw` for consistency with `request_deposit`. This is a bug fix, not an enhancement.

---

## Implementation Checklist

### Bug Fix: Missing Deadline Validation (Priority: High)
- [ ] Add `assert(deadline > 0, "Deadline must be greater than zero");` to `request_withdraw` at `main.nr:772` (after line 771, before any other logic)
- [ ] Add unit test for `deadline=0` rejection in withdraw flow

### Code Cleanup: Dead Code Removal
- [ ] Remove or annotate `compute_withdraw_confirmation_content` function at `main.nr:186-215`
- [ ] Remove import from `main.nr:305` if function is deleted

### Enhancement 1: Secret-Bound Confirmations
- [ ] Clarify if L1→L2 confirmation is needed (vs current TokenPortal flow)
- [ ] If needed: Add `secret_hash` parameter to `compute_withdraw_confirmation_content`
- [ ] If needed: Implement `finalize_withdraw` that consumes confirmation
- [ ] Store `secret_hash` on L1 if needed for confirmation

### Enhancement 2: Per-Intent Owner Hash
- [ ] **Reorder statements in `request_deposit`**: Move `salt` computation (line 522) before `owner_hash` (line 518)
- [ ] Update `request_deposit` to use `poseidon2_hash([caller, salt])` at `main.nr:518`
- [ ] Update `request_withdraw` to use `poseidon2_hash([owner, intent_id])` at `main.nr:822`
- [ ] Update documentation for owner_hash computation
- [ ] Update any off-chain services that reconstruct owner_hash
- [ ] Add tests for owner_hash uniqueness across intents
- [ ] Consider impact on `claim_refund` flow

---

## References

- `aztec/aave_wrapper/src/main.nr` - Main L2 contract
- `eth/contracts/AztecAavePortalL1.sol` - L1 portal
- `eth/contracts/TokenPortal.sol` - Token bridge
- `aztec/aave_wrapper/src/types/intent.nr` - Noir intent types
- `eth/contracts/types/Intent.sol` - Solidity intent types
- `docs/WITHDRAW_TRANSACTION_FLOW.md` - Transaction flow documentation
- `PROTOCOL.md:417` - Original enhancement proposals
