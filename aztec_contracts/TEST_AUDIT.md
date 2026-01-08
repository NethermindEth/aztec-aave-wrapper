# Test Suite Audit: `aztec_contracts/src/test`

**Date:** 2026-01-08
**Scope:** Unit tests for AaveWrapper L2 contract helper functions
**Files Reviewed:**
- `src/test/mod.nr`
- `src/test/deposit_tests.nr`
- `src/test/withdraw_tests.nr`
- `src/test/edge_cases.nr`
- `src/main.nr` (contract implementation)
- `src/types/*.nr` (type definitions)

---

## Executive Summary

| Criterion | Status | Score |
|-----------|--------|-------|
| Testing expected behavior (not adapted to pass) | PASS | 9/10 |
| All invariants tested | PARTIAL | 6/10 |
| All edge cases tested | PARTIAL | 7/10 |
| All failures tested | INSUFFICIENT | 3/10 |

**Overall Assessment:** The test suite provides solid coverage for pure hash computation functions but lacks critical failure path testing for contract state transitions. The tests appear to verify expected cryptographic behavior rather than being adapted to pass implementation.

---

## 1. Tests Testing Expected Behavior

### Verdict: PASS

The tests follow good practices for cryptographic function testing:
- Hash determinism tests verify that same inputs produce same outputs
- Hash uniqueness tests verify collision resistance for all input parameters
- Security tests verify front-running and replay protection properties

### Potential Concern

**File:** `edge_cases.nr:266-291`
**Test:** `test_withdraw_vs_deposit_confirmation_content`

```noir
// They should actually be equal since the hash function is the same
assert(deposit_hash == withdraw_hash, "Same inputs should produce same hash");
```

This test asserts that `compute_deposit_confirmation_content` and `compute_withdraw_confirmation_content` produce **identical hashes** for the same inputs. While the comment states "it's the context (intent status) that distinguishes them," this tests implementation behavior rather than a security invariant.

**Recommendation:** Review whether this is architecturally intentional. If the L1 portal uses the same hash format for both message types, there could be potential for message type confusion.

---

## 2. Invariants Tested

### Verdict: PARTIAL

### Tested Invariants

| Invariant | Test Location | Status |
|-----------|---------------|--------|
| Hash determinism (same inputs → same output) | All `*_deterministic` tests | PASS |
| Hash uniqueness (different inputs → different output) | All `*_different_inputs` tests | PASS |
| Caller binding (intent bound to caller address) | `edge_cases.nr:177-191` | PASS |
| Secret binding (message bound to secret_hash) | `edge_cases.nr:217-229` | PASS |
| Salt provides replay protection | `deposit_tests.nr:94-111` | PASS |
| Status constants are mutually exclusive | `withdraw_tests.nr:325-338` | PASS |
| Input order affects hash | `edge_cases.nr:441-462` | PASS |

### Missing Invariants

#### 2.1 Intent ID Global Uniqueness

**Missing Test:** Explicit test proving two different users with identical parameters (amount, asset, chain, deadline, salt) but different addresses get different intent IDs.

```noir
// Suggested test
#[test]
unconstrained fn test_intent_id_unique_per_caller() {
    let user_a = AztecAddress::from_field(0xAAAA);
    let user_b = AztecAddress::from_field(0xBBBB);

    // Same parameters, different callers
    let intent_a = compute_intent_id(user_a, 1, 1000, 23, 1700000000, 42);
    let intent_b = compute_intent_id(user_b, 1, 1000, 23, 1700000000, 42);

    assert(intent_a != intent_b, "Different users must get different intent IDs");
}
```

#### 2.2 Serialization Round-Trip

**Missing Test:** `DepositIntent` and `WithdrawIntent` derive `Serialize`/`Deserialize` but no tests verify round-trip integrity.

```noir
// Suggested test
#[test]
unconstrained fn test_deposit_intent_serialization_roundtrip() {
    let original = DepositIntent::new(0x123, 1, 1000, 23, 1700000000, 42);
    let serialized = original.serialize();
    let deserialized = DepositIntent::deserialize(serialized);
    assert(original == deserialized, "Round-trip must preserve data");
}
```

#### 2.3 Message Domain Separation

**Missing Test:** Verify that `compute_deposit_message_content` and `compute_withdraw_message_content` produce different hashes even with semantically similar data.

```noir
// Suggested test - verify domain separation between message types
#[test]
unconstrained fn test_deposit_withdraw_message_domain_separation() {
    let intent_id: Field = 0x123;
    let asset_id: Field = 1;
    let amount: u128 = 1000;
    let chain_id: u32 = 23;
    let deadline: u64 = 1700000000;
    let salt: u32 = 1;
    let secret_hash: Field = 0xdeadbeef;

    let deposit_intent = DepositIntent::new(intent_id, asset_id, amount, chain_id, deadline, salt);
    let withdraw_intent = WithdrawIntent::new(intent_id, amount, deadline);

    let deposit_hash = compute_deposit_message_content(deposit_intent, secret_hash);
    let withdraw_hash = compute_withdraw_message_content(withdraw_intent, asset_id, chain_id, secret_hash);

    // These MUST be different to prevent cross-message-type attacks
    assert(deposit_hash != withdraw_hash, "Deposit and withdraw messages must have different hashes");
}
```

---

## 3. Edge Cases Tested

### Verdict: PARTIAL

### Well-Covered Edge Cases

| Edge Case | Test Location | Status |
|-----------|---------------|--------|
| Zero values (all functions) | `edge_cases.nr:26-68` | PASS |
| Max u128 values (shares/amount) | `edge_cases.nr:76-117` | PASS |
| Max u32 values (chain_id, salt) | `edge_cases.nr:147-155` | PASS |
| Max u64 values (deadline) | `edge_cases.nr:158-167` | PASS |
| Minimum amounts (1 wei) | `deposit_tests.nr:427-439`, `withdraw_tests.nr:297-309` | PASS |
| Large amounts (whale deposits) | `deposit_tests.nr:407-423` | PASS |
| Partial withdrawal | `withdraw_tests.nr:89-112` | PASS |
| Different target chains | `deposit_tests.nr:443-461`, `withdraw_tests.nr:424-441` | PASS |
| Similar inputs (collision resistance) | `edge_cases.nr:234-255` | PASS |
| Past vs future deadlines | `edge_cases.nr:490-503` | PASS |

### Missing Edge Cases

#### 3.1 Zero AztecAddress Caller

**Location:** `edge_cases.nr:27` tests zero address but doesn't verify specific behavior implications.

```noir
// Suggested explicit test
#[test]
unconstrained fn test_zero_address_caller_produces_valid_hash() {
    let zero_caller = AztecAddress::from_field(0);
    let hash = compute_intent_id(zero_caller, 1, 1000, 23, 1700000000, 1);

    // Verify it's different from any non-zero caller
    let non_zero_caller = AztecAddress::from_field(1);
    let hash2 = compute_intent_id(non_zero_caller, 1, 1000, 23, 1700000000, 1);

    assert(hash != hash2, "Zero address must produce different hash than address(1)");
}
```

#### 3.2 Single Non-Zero Field

**Missing:** Tests use all-zeros or all-max values but not sparse inputs.

```noir
// Suggested test
#[test]
unconstrained fn test_sparse_inputs_produce_unique_hashes() {
    let secret_hash: Field = 0xdeadbeef;

    // Only intent_id non-zero
    let intent1 = DepositIntent::new(0x123, 0, 0, 0, 0, 0);
    // Only asset_id non-zero
    let intent2 = DepositIntent::new(0, 0x123, 0, 0, 0, 0);

    let hash1 = compute_deposit_message_content(intent1, secret_hash);
    let hash2 = compute_deposit_message_content(intent2, secret_hash);

    assert(hash1 != hash2, "Sparse inputs in different fields must differ");
}
```

#### 3.3 Boundary Transitions

**Missing:** Values at `MAX - 1` boundaries.

```noir
// Suggested test
#[test]
unconstrained fn test_boundary_values() {
    let secret_hash: Field = 0xdeadbeef;

    let intent_max = DepositIntent::new(0x123, 1, 0xffffffffffffffffffffffffffffffff, 23, 1700000000, 1);
    let intent_near_max = DepositIntent::new(0x123, 1, 0xfffffffffffffffffffffffffffffffe, 23, 1700000000, 1);

    let hash_max = compute_deposit_message_content(intent_max, secret_hash);
    let hash_near = compute_deposit_message_content(intent_near_max, secret_hash);

    assert(hash_max != hash_near, "Adjacent boundary values must differ");
}
```

#### 3.4 Invalid State: Zero-Share Active Position

**File:** `edge_cases.nr:388-399`
**Issue:** Test creates a `PositionReceiptNote` with `shares: 0` and `status: ACTIVE`.

```noir
let receipt = PositionReceiptNote {
    shares: 0, // Fully withdrawn
    status: PositionStatus::ACTIVE, // But marked as active?
};
```

**Problem:** According to `main.nr:687-699`, the contract only creates a remaining Active note if `shares > 0`. A zero-share Active note should never exist in production.

**Recommendation:** Either:
1. Remove this test as invalid state, OR
2. Add a comment explaining this is testing struct capability, not valid contract state

---

## 4. Failure Cases Tested

### Verdict: INSUFFICIENT

### Contract Function Failures (Untested)

The following assertions in contract functions have **no test coverage**:

| Assertion | Location | Risk Level |
|-----------|----------|------------|
| `"Intent ID already consumed"` | `main.nr:359` | HIGH |
| `"Intent not in pending deposit state"` | `main.nr:460` | HIGH |
| `"Intent already consumed"` | `main.nr:464` | HIGH |
| `"Position receipt note not found"` | `main.nr:524` | HIGH |
| `"Not the owner of this position"` | `main.nr:528` | CRITICAL |
| `"Position is not active"` | `main.nr:531` | HIGH |
| `"Withdrawal amount exceeds available shares"` | `main.nr:534` | CRITICAL |
| `"Pending withdraw receipt note not found"` | `main.nr:669` | HIGH |
| `"Not the owner of this position"` (withdraw) | `main.nr:673` | CRITICAL |
| `"Position is not pending withdrawal"` | `main.nr:676-679` | HIGH |
| `"Asset ID mismatch"` | `main.nr:682` | HIGH |
| `"Target chain ID mismatch"` | `main.nr:683` | HIGH |
| `"Intent not in pending withdraw state"` | `main.nr:723` | HIGH |

### Security Impact of Missing Tests

1. **Replay Attacks:** Without testing `"Intent ID already consumed"`, there's no verification that replay protection works.

2. **Authorization Bypass:** Without testing `"Not the owner of this position"`, there's no verification that users can't claim others' deposits.

3. **Over-withdrawal:** Without testing `"Withdrawal amount exceeds available shares"`, there's no verification of balance checks.

4. **State Machine Violations:** Without testing status transition assertions, invalid state progressions could go undetected.

### Suggested TXE Test Cases

```noir
// These require TXE (Test Execution Environment) setup

#[test(should_fail_with = "Intent ID already consumed")]
fn test_replay_protection() {
    // 1. Create and finalize a deposit
    // 2. Attempt to finalize same intent again
    // Should fail with replay protection error
}

#[test(should_fail_with = "Not the owner of this position")]
fn test_unauthorized_withdrawal() {
    // 1. User A creates deposit
    // 2. User B attempts to withdraw User A's position
    // Should fail with authorization error
}

#[test(should_fail_with = "Withdrawal amount exceeds available shares")]
fn test_over_withdrawal() {
    // 1. Deposit 100 shares
    // 2. Attempt to withdraw 101 shares
    // Should fail with insufficient balance error
}

#[test(should_fail_with = "Position is not active")]
fn test_double_withdrawal_request() {
    // 1. Create deposit, finalize it
    // 2. Request withdrawal (status → PENDING_WITHDRAW)
    // 3. Attempt second withdrawal request
    // Should fail because position is no longer Active
}

#[test(should_fail_with = "Intent not in pending deposit state")]
fn test_finalize_non_pending_deposit() {
    // 1. Attempt to finalize deposit that was never requested
    // Should fail with invalid state error
}
```

---

## 5. Recommendations

### Priority 1: Critical (Security Impact) ✅ IMPLEMENTED

Tests implemented in `/e2e/src/integration.test.ts` using aztec.js:

1. **Authorization check tests** ✅
   - `should prevent user from withdrawing another user's position` - Tests "Not the owner of this position"
   - `should prevent user from finalizing another user's withdrawal` - Tests unauthorized finalization

2. **Replay protection tests** ✅
   - `should prevent intent ID from being consumed twice` - Tests "Intent ID already consumed" assertion
   - `should prevent double finalization of deposit` - Verifies same intent cannot be finalized twice
   - `should prevent finalizing non-pending deposit` - Tests invalid state transition

3. **Balance validation tests** ✅
   - `should prevent withdrawal exceeding available shares` - Tests "Withdrawal amount exceeds available shares"
   - `should prevent double withdrawal request` - Tests position cannot be withdrawn twice
   - `should prevent finalizing non-pending withdrawal` - Tests invalid withdrawal state

**Note:** These tests use aztec.js TypeScript instead of Noir TXE because:
- aztec.js provides a more stable API for stateful contract testing
- Better integration with PXE and account management
- Enables full L1↔L2 message flow testing when needed

### Priority 2: High (Correctness)

4. **Add state machine transition tests**
   - Valid: `UNKNOWN → PENDING_DEPOSIT → CONFIRMED → PENDING_WITHDRAW → CONFIRMED`
   - Invalid transitions should fail

5. **Add serialization round-trip tests**
   - Verify `DepositIntent` and `WithdrawIntent` serialize/deserialize correctly

6. **Add domain separation test**
   - Verify deposit and withdraw message types cannot be confused

### Priority 3: Medium (Completeness)

7. **Add sparse input edge cases**
   - Test single non-zero field variations

8. **Review zero-share Active note test**
   - Either remove as invalid state or document why it's tested

9. **Add boundary transition tests**
   - Test `MAX - 1` values for all numeric types

---

## Appendix: Test Coverage Matrix

### Helper Functions

| Function | Determinism | Uniqueness | Zero Values | Max Values | Security |
|----------|-------------|------------|-------------|------------|----------|
| `compute_intent_id` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `compute_deposit_message_content` | ✅ | ✅ | ✅ | ⚠️ | ✅ |
| `compute_deposit_confirmation_content` | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| `compute_withdraw_message_content` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `compute_withdraw_confirmation_content` | ✅ | ✅ | ✅ | ✅ | ⚠️ |

### Contract Functions

| Function | Happy Path | Failure Paths | Authorization | State Transitions |
|----------|------------|---------------|---------------|-------------------|
| `constructor` | ⚠️ | ❌ | N/A | N/A |
| `request_deposit` | ⚠️ | ❌ | ✅ | ⚠️ |
| `_set_intent_pending_deposit` | ⚠️ | ✅ | N/A | ⚠️ |
| `finalize_deposit` | ⚠️ | ⚠️ | ✅ | ⚠️ |
| `_finalize_deposit_public` | ⚠️ | ✅ | N/A | ✅ |
| `request_withdraw` | ⚠️ | ✅ | ✅ | ⚠️ |
| `_request_withdraw_public` | ⚠️ | ❌ | N/A | ⚠️ |
| `finalize_withdraw` | ⚠️ | ⚠️ | ✅ | ⚠️ |
| `_finalize_withdraw_public` | ⚠️ | ✅ | N/A | ✅ |

**Legend:** ✅ Tested | ⚠️ Partial | ❌ Not Tested | N/A Not Applicable

**Note:** Integration tests for authorization, replay protection, and balance validation (Priority 1 Critical tests)
are implemented in TypeScript using aztec.js. See `/e2e/src/integration.test.ts`.

Run integration tests: `cd e2e && npm test -- integration.test.ts`
Run Noir unit tests: `cd aztec_contracts && aztec test`
