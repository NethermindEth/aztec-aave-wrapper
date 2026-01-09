# E2E Test Suite Audit: `/e2e/src`

**Date:** 2026-01-09
**Scope:** End-to-end and integration tests for Aztec Aave Wrapper
**Files Reviewed:**
- `src/e2e.test.ts`
- `src/integration.test.ts`
- `vitest.config.ts`
- `package.json`

**Reference Documents:**
- `/aztec_contracts/TEST_AUDIT.md` (Noir unit test audit)
- `/aztec_contracts/src/main.nr` (contract implementation)
- `/spec.md` (system specification)

---

## Executive Summary

| Criterion | Status | Score | Critical Issues |
|-----------|--------|-------|-----------------|
| Testing expected behavior (not adapted to pass) | FAIL | 3/10 | Weak assertions, vague error expectations |
| All functionalities covered | CRITICAL FAILURE | 1/10 | e2e.test.ts 0% implemented, claim_refund untested |
| Edge cases tested | INSUFFICIENT | 2/10 | Missing amount/deadline/secret validation |
| Full integration flows | FAIL | 2/10 | No complete deposit→withdraw cycles |

**Overall Assessment: INSUFFICIENT ⚠️**

The e2e test suite has **critical gaps** that make it inadequate for production validation:
- `e2e.test.ts`: **100% TODO** - zero actual tests implemented
- `integration.test.ts`: **Partial implementation** with quality issues
- **Entire features untested**: `claim_refund`, deadline validation, secret hash validation
- **Test philosophy violations**: Weak assertions that adapt to code rather than verify expected behavior

---

## 1. File-by-File Analysis

### 1.1 `e2e.test.ts` - COMPLETE FAILURE ❌

**Status:** 12 test cases, 12 marked as `it.todo()` - **ZERO IMPLEMENTATION**

This file is essentially a wishlist of tests that should exist, but contains no actual implementation. It's a documentation file masquerading as a test suite.

#### Unimplemented Tests:

| Test | Location | Priority | Status |
|------|----------|----------|--------|
| Full deposit cycle | Lines 84 | CRITICAL | TODO |
| Expired deadline rejection | Lines 90 | HIGH | TODO |
| Replay protection (deposit) | Lines 96 | CRITICAL | TODO |
| Full withdrawal cycle | Lines 111 | CRITICAL | TODO |
| Invalid receipt rejection | Lines 117 | HIGH | TODO |
| Full deposit→withdraw cycle | Lines 125 | CRITICAL | TODO |
| Multiple concurrent deposits | Lines 133 | MEDIUM | TODO |
| Unauthorized source rejection | Lines 142 | HIGH | TODO |
| Aave supply failure handling | Lines 149 | MEDIUM | TODO |
| Deadline enforcement on L1 | Lines 156 | HIGH | TODO |
| Double finalization prevention | Lines 163 | CRITICAL | TODO |

**Assessment:** This file provides **ZERO value** to the test suite. Every test that should verify cross-chain behavior is unimplemented.

**Impact:** Cannot verify that:
- L2→L1→Target→L1→L2 message flow works
- Wormhole bridging functions correctly
- Aave operations execute properly
- Portal authorization is enforced
- Deadline enforcement works across chains

---

### 1.2 `integration.test.ts` - MIXED QUALITY ⚠️

**Status:** 8 tests implemented, 2 marked TODO, multiple quality issues

This file has actual implementation but suffers from tests that "adapt to pass" rather than asserting expected behavior.

#### Tests That Violate "Assert Expected Behavior" Principle:

##### Issue 1: Weak Intent ID Validation ⚠️

**Location:** Lines 206-226, 261-275, 318-332

```typescript
// Create call instance once, then simulate and send on same instance
const depositCall = userAMethods.request_deposit(
    1n,
    TEST_CONFIG.depositAmount,
    TEST_CONFIG.chainId,
    deadline,
    secretA
);

// Simulate first to get the return value (intent ID)
const intentIdA = await depositCall.simulate();

// Assert: Intent ID should be a valid non-zero field element
expect(intentIdA).toBeDefined();
expect(intentIdA.toString()).not.toBe("0");
```

**Problem:** The test accepts **any** non-zero value as valid. It doesn't verify the intent ID is computed correctly.

**Expected Behavior:** The intent ID should be the Poseidon2 hash of:
```
hash([caller, asset_id, amount, original_decimals, target_chain_id, deadline, salt])
```

**Fix Required:**
```typescript
// Compute expected intent ID
const expectedIntentId = computeIntentId(
    userAWallet.getAddress(),
    1n,
    TEST_CONFIG.depositAmount,
    6, // USDC decimals
    TEST_CONFIG.chainId,
    deadline,
    // Need to extract salt from transaction or deterministically set it
);

expect(intentIdA.toString()).toBe(expectedIntentId.toString());
```

**Why This Matters:** If the contract has a bug in intent ID computation (e.g., omits a field from the hash), this test would still pass. It's testing "function returned something" not "function returned the correct value."

---

##### Issue 2: Vague Error Expectations ⚠️

**Location:** Lines 239-244, 284-296

```typescript
// This should fail because User B doesn't have User A's position note.
// The error depends on Aztec's note discovery:
// - "Position receipt note not found": User B's PXE has no note for this intent
// - "Not the owner": Note exists but owner check fails (shouldn't happen in practice)
// We primarily expect "Position receipt note not found" since User B's wallet
// was never given access to User A's notes.
await expect(
    userBMethods
        .request_withdraw(intentIdA, TEST_CONFIG.withdrawAmount, deadline, secretB)
        .send()
        .wait()
).rejects.toThrow(/Position receipt note not found/);
```

**Problem:** The comment reveals uncertainty about which error should occur. The regex accepts multiple different errors, meaning the test doesn't have a clear expectation.

**Root Cause:** The test is adapting to whatever error the system happens to throw, rather than verifying the specific security mechanism works.

**Fix Required:**
```typescript
// Authorization should be enforced at the contract level, not PXE level
// The specific error should be deterministic based on the contract assertion

// If testing PXE-level note discovery:
await expect(
    userBMethods.request_withdraw(intentIdA, ...)
).rejects.toThrow(/Position receipt note not found/);

// If testing contract-level authorization (after PXE returns note):
// This would require mocking PXE to provide the note to User B
await expect(
    userBMethods.request_withdraw(intentIdA, ...)
).rejects.toThrow(/Not the owner of this position/);
```

**Similar Issues:**
- Lines 340-342: `/Intent ID already consumed|Intent not in pending deposit state/`
- Lines 372-374: `/Intent not in pending deposit state|Intent already consumed/`
- Lines 388-390: `/Intent not in pending deposit state/` (this one is specific, good)

---

##### Issue 3: Indirect State Verification ⚠️

**Location:** Lines 334-343

```typescript
// STATE CHANGE VERIFICATION:
// The intent status in public storage should now be PENDING_DEPOSIT.
// We verify this by attempting to set it as pending again - which should fail
// because the contract checks `consumed_intents` mapping.
// Try to set the same intent as pending again via public function
// This simulates a replay attack
await expect(methods._set_intent_pending_deposit(intentId).send().wait()).rejects.toThrow(
    /Intent ID already consumed/
);
```

**Problem:** Testing state indirectly by calling a function and checking if it fails, rather than directly reading the `consumed_intents` storage.

**Why This Is "Adapting To Pass":** The test is working around the inability to read contract storage directly. If the `_set_intent_pending_deposit` function has a different bug that causes it to fail for a different reason, this test would still pass.

**Better Approach:**
```typescript
// Directly read public storage (if aztec.js supports it)
const intentStatus = await aaveWrapper.methods.view_intent_status(intentId).view();
expect(intentStatus).toBe(IntentStatus.PENDING_DEPOSIT);

// Then test replay protection separately
await expect(
    methods._set_intent_pending_deposit(intentId).send().wait()
).rejects.toThrow(/Intent ID already consumed/);
```

---

##### Issue 4: Improper Test State Setup ⚠️

**Location:** Lines 369-375

```typescript
const intentId = await depositCall.simulate();
await depositCall.send().wait();

// First attempt to finalize via public function
// This will fail because the intent is in PENDING_DEPOSIT state (not yet confirmed via L1 message)
// The contract requires CONFIRMED status before deposits can be finalized
await expect(methods._finalize_deposit_public(intentId).send().wait()).rejects.toThrow(
    /Intent not in pending deposit state|Intent already consumed/
);
```

**Problem:** The comment admits the test doesn't properly set up the state to test the specific assertion. It's testing whatever happens to fail.

**What Should Happen:**
1. Create deposit request (status: PENDING_DEPOSIT)
2. Simulate L1 confirmation message (status: CONFIRMED)
3. Call finalize_deposit first time (should succeed)
4. Call finalize_deposit second time (should fail with "Intent already consumed")

**Current Reality:** Test only does step 1 and 4, so it's testing "can't finalize an unconfirmed deposit" rather than "can't finalize twice."

**Fix Required:**
```typescript
// Test name: "should prevent double finalization of deposit"
// But currently tests: "should prevent finalizing unconfirmed deposit"

// Need to inject L1 message to properly test double finalization
const intentId = await depositCall.simulate();
await depositCall.send().wait();

// Simulate L1 confirmation (requires test infrastructure)
await injectL1Message({
    sender: portalAddress,
    content: computeDepositConfirmationContent(intentId, assetId, shares, chainId)
});

// First finalization should succeed
await methods.finalize_deposit(intentId, ...).send().wait();

// Second finalization should fail
await expect(
    methods.finalize_deposit(intentId, ...).send().wait()
).rejects.toThrow(/Intent already consumed/);
```

---

#### Test Infrastructure Workarounds 🚩

**Location:** Lines 206-224

```typescript
// Create call instance once, then simulate and send on same instance
// This avoids race conditions from creating separate call instances
const depositCall = userAMethods.request_deposit(...);

// Simulate first to get the return value (intent ID)
const intentIdA = await depositCall.simulate();

// Send the same call instance
await depositCall.send().wait();
```

**Problem:** Comment reveals a workaround for aztec.js quirks. Tests should not need to work around framework race conditions.

**Why This Is Concerning:**
- If aztec.js has race conditions, they should be fixed in aztec.js
- Tests working around framework bugs hide issues that will affect production code
- Future maintainers may not understand why this pattern is necessary

**Recommendation:** Document this as a known limitation and file an issue with aztec.js if one doesn't exist.

---

## 2. Missing Functionality Coverage

### 2.1 CRITICAL: `claim_refund` Feature Completely Untested ❌

**Contract Function:** `main.nr:866-906`

**Missing Test Coverage:**

| Scenario | Location in Contract | Test Status |
|----------|---------------------|-------------|
| Successful refund after deadline | Lines 866-906 | ❌ NOT TESTED |
| Refund rejection before deadline | Line 870: `assert(current_time >= deadline)` | ❌ NOT TESTED |
| Double refund prevention | Line 877: Note nullification | ❌ NOT TESTED |
| Current time validation | Line 869: `assert(current_time > 0)` | ❌ NOT TESTED |
| New note creation with new nonce | Lines 882-892 | ❌ NOT TESTED |
| Note status transition (PENDING_WITHDRAW → ACTIVE) | Line 890 | ❌ NOT TESTED |

**Impact:** The refund mechanism is a **critical recovery path** for users whose withdrawal requests expire. If it's broken, users could lose access to their funds.

**Required Tests:**
```typescript
describe("Refund Flow", () => {
    it("should allow refund after deadline expires", async () => {
        // 1. Create withdrawal request with deadline
        // 2. Advance time past deadline
        // 3. Call claim_refund
        // 4. Verify new Active note created
        // 5. Verify original note nullified
    });

    it("should reject refund before deadline", async () => {
        // 1. Create withdrawal request with future deadline
        // 2. Call claim_refund immediately
        // 3. Expect error: "Deadline has not passed yet"
    });

    it("should prevent double refund", async () => {
        // 1. Create withdrawal request
        // 2. Advance time past deadline
        // 3. Call claim_refund (should succeed)
        // 4. Call claim_refund again (should fail - note already nullified)
    });

    it("should reject zero current_time", async () => {
        // 1. Create withdrawal request
        // 2. Call claim_refund with current_time = 0
        // 3. Expect error: "Current time must be greater than zero"
    });

    it("should generate new nonce for refunded note", async () => {
        // 1. Create withdrawal request with known nonce
        // 2. Claim refund
        // 3. Verify refunded note has different nonce
        // 4. Verify: hash(original_nonce, owner) === new_nonce
    });
});
```

---

### 2.2 HIGH: Deadline Validation Never Tested ❌

**Contract Assertions:**
- `main.nr:357`: `assert(deadline > 0, "Deadline must be greater than zero")`
- `main.nr:870`: `assert(current_time >= deadline, "Deadline has not passed yet")`

**Missing Test Coverage:**

| Scenario | Priority | Status |
|----------|----------|--------|
| Deposit with past deadline | HIGH | ❌ NOT TESTED |
| Deposit with zero deadline | HIGH | ❌ NOT TESTED |
| Withdrawal with past deadline | HIGH | ❌ NOT TESTED |
| Withdrawal with zero deadline | HIGH | ❌ NOT TESTED |
| Refund before deadline expires | CRITICAL | ❌ NOT TESTED |
| Refund after deadline expires | CRITICAL | ❌ NOT TESTED |

**Why This Matters:** Deadline enforcement is a **security feature** that prevents replay attacks and ensures timely execution. If broken, expired intents could be executed, enabling attacks.

**Required Tests:**
```typescript
describe("Deadline Validation", () => {
    it("should reject deposit with expired deadline", async () => {
        const pastDeadline = BigInt(Math.floor(Date.now() / 1000) - 3600); // 1 hour ago

        await expect(
            methods.request_deposit(1n, 1000000n, 23, pastDeadline, secret).send().wait()
        ).rejects.toThrow(/Deadline must be greater than zero|Deadline expired/);
    });

    it("should reject deposit with zero deadline", async () => {
        await expect(
            methods.request_deposit(1n, 1000000n, 23, 0n, secret).send().wait()
        ).rejects.toThrow(/Deadline must be greater than zero/);
    });

    it("should accept deposit with future deadline", async () => {
        const futureDeadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

        const intentId = await methods
            .request_deposit(1n, 1000000n, 23, futureDeadline, secret)
            .send()
            .wait();

        expect(intentId).toBeDefined();
    });

    // Similar for withdrawal requests
});
```

---

### 2.3 HIGH: Secret Hash Validation Never Tested ❌

**Contract Logic:**
- `main.nr:372-377`: Secret hash included in L2→L1 message
- `main.nr:479`: Secret verification in `finalize_deposit`
- `main.nr:631`: Secret verification in `request_withdraw`
- `main.nr:749`: Secret verification in `finalize_withdraw`

**Missing Test Coverage:**

| Scenario | Priority | Status |
|----------|----------|--------|
| Finalize deposit with wrong secret | CRITICAL | ❌ NOT TESTED |
| Finalize withdrawal with wrong secret | CRITICAL | ❌ NOT TESTED |
| Finalize with zero secret | HIGH | ❌ NOT TESTED |
| Finalize with secret from different user | CRITICAL | ❌ NOT TESTED |

**Why This Matters:** Secret hash verification is the **primary authorization mechanism** for claiming funds. If broken, anyone could claim any user's deposits/withdrawals.

**Required Tests:**
```typescript
describe("Secret Hash Authorization", () => {
    it("should reject finalize_deposit with wrong secret", async () => {
        const correctSecret = Fr.random();
        const wrongSecret = Fr.random();

        // Request deposit with correctSecret
        const intentId = await methods
            .request_deposit(1n, 1000000n, 23, deadline, correctSecret)
            .send()
            .wait();

        // Simulate L1 confirmation
        await injectL1Message({ intentId, secret_hash: hash(correctSecret) });

        // Try to finalize with wrongSecret
        await expect(
            methods.finalize_deposit(intentId, 1n, 1000000n, 23, wrongSecret, 0n).send().wait()
        ).rejects.toThrow(/Secret hash mismatch|Invalid secret/);
    });

    it("should accept finalize_deposit with correct secret", async () => {
        const correctSecret = Fr.random();

        const intentId = await methods
            .request_deposit(1n, 1000000n, 23, deadline, correctSecret)
            .send()
            .wait();

        await injectL1Message({ intentId, secret_hash: hash(correctSecret) });

        // Should succeed
        await methods.finalize_deposit(intentId, 1n, 1000000n, 23, correctSecret, 0n).send().wait();
    });

    // Similar for withdrawal finalization
});
```

---

### 2.4 MEDIUM: Amount Edge Cases Not Tested ⚠️

**Missing Test Coverage:**

| Scenario | Priority | Status |
|----------|----------|--------|
| Deposit with zero amount | MEDIUM | ❌ NOT TESTED |
| Withdrawal with zero amount | MEDIUM | ❌ NOT TESTED |
| Deposit with max u128 amount | LOW | ❌ NOT TESTED |
| Partial withdrawal (less than total shares) | HIGH | ⚠️ PARTIAL (no integration test) |
| Over-withdrawal (more than available shares) | CRITICAL | ❌ TODO (line 411) |
| Withdrawal of exact available shares | MEDIUM | ❌ NOT TESTED |

**Note:** While `main.nr:534` has assertion `"Withdrawal amount exceeds available shares"`, this is marked TODO in integration tests.

---

### 2.5 MEDIUM: Chain ID and Asset ID Validation ⚠️

**Contract Assertions:**
- `main.nr:682`: `assert(asset_id == note.asset_id, "Asset ID mismatch")`
- `main.nr:683`: `assert(target_chain_id == note.target_chain_id, "Target chain ID mismatch")`

**Missing Test Coverage:**

| Scenario | Priority | Status |
|----------|----------|--------|
| Finalize withdrawal with wrong asset ID | HIGH | ❌ NOT TESTED |
| Finalize withdrawal with wrong chain ID | HIGH | ❌ NOT TESTED |
| Deposit to invalid chain ID | MEDIUM | ❌ NOT TESTED |
| Deposit with zero asset ID | LOW | ❌ NOT TESTED |

---

### 2.6 CRITICAL: Full Cycle Flows Never Tested ❌

**From spec.md § 10: "User Stories - Detailed Scenarios"**

Required end-to-end flows that are **completely unimplemented**:

1. **Complete Deposit Flow** (e2e.test.ts:84 - TODO)
   - L2: `request_deposit()`
   - L1: Portal consumes message, bridges via Wormhole
   - Target: Executor supplies to Aave
   - L1: Portal receives confirmation
   - L2: `finalize_deposit()` creates PositionReceiptNote

2. **Complete Withdrawal Flow** (e2e.test.ts:111 - TODO)
   - L2: `request_withdraw()` with receipt
   - L1: Portal consumes message, bridges withdrawal request
   - Target: Executor withdraws from Aave, bridges tokens
   - L1: Portal receives tokens and confirmation
   - L2: `finalize_withdraw()` updates user balance

3. **Full Deposit → Withdraw Cycle** (e2e.test.ts:125 - TODO)
   - Complete deposit
   - Verify position active
   - Complete withdrawal
   - Verify position closed

4. **Multiple Positions Per User** (e2e.test.ts:133 - TODO)
   - User creates deposit A
   - User creates deposit B
   - Verify both positions independent
   - Withdraw from A only
   - Verify B unaffected

**Impact:** Cannot verify that the system works as specified. All cross-chain functionality is **untested**.

---

### 2.7 HIGH: Status Transition Testing Incomplete ⚠️

**Contract Status Flow:**
```
UNKNOWN → PENDING_DEPOSIT → [L1 confirms] → ACTIVE → PENDING_WITHDRAW → [L1 confirms] → CLOSED
                                                   ↘ [deadline expired] → ACTIVE (via refund)
```

**Contract Assertions for Status Transitions:**

| Assertion | Location | Test Coverage |
|-----------|----------|---------------|
| "Intent ID already consumed" | main.nr:359 | ⚠️ INDIRECT (line 340) |
| "Intent not in pending deposit state" | main.nr:460 | ✅ TESTED (line 388) |
| "Intent already consumed" (deposit) | main.nr:464 | ⚠️ INDIRECT (line 372) |
| "Position receipt note not found" | main.nr:524 | ✅ TESTED (line 244) |
| "Position is not active" | main.nr:531 | ❌ TODO (line 423) |
| "Withdrawal amount exceeds available shares" | main.nr:534 | ❌ TODO (line 411) |
| "Pending withdraw receipt note not found" | main.nr:669 | ✅ TESTED (line 296) |
| "Position is not pending withdrawal" | main.nr:676-679 | ❌ NOT TESTED |
| "Intent not in pending withdraw state" | main.nr:723 | ✅ TESTED (line 437) |

**Missing Tests:**
- Attempt to request withdrawal from already-pending-withdrawal position
- Attempt to request withdrawal from finalized position
- Verify status transitions in correct sequence

---

### 2.8 LOW: Portal Authorization Never Tested ⚠️

**Contract Storage:** `main.nr:261-262`
```noir
portal: SharedImmutable<EthAddress>
```

**Missing Tests:**
- Can unauthorized L1 address send L1→L2 messages?
- Does contract verify message sender is the registered portal?
- Can portal address be updated?

**Note:** This may be enforced by Aztec protocol rather than contract logic, but should be verified.

---

## 3. Test Philosophy Violations Summary

### 3.1 Weak Assertions That "Adapt To Pass"

| Issue | Location | Severity |
|-------|----------|----------|
| Intent ID not verified for correctness | Lines 220-221, 272-273, 329-330 | HIGH |
| Vague error expectations (multiple acceptable errors) | Lines 244, 296, 342, 374 | MEDIUM |
| Indirect state verification | Lines 340-342 | MEDIUM |
| Improper test state setup | Lines 369-375 | HIGH |
| Test name doesn't match what's tested | Lines 345-375 | MEDIUM |

### 3.2 Tests That Should Fail But Don't

If these bugs existed, current tests would **incorrectly pass**:

1. **Intent ID computed with wrong parameters** → Test just checks `!= 0`
2. **Wrong error thrown** → Test accepts multiple errors via regex
3. **State not properly updated** → Test checks side effect, not state
4. **Wrong values stored in notes** → Tests never read note contents

---

## 4. Recommendations

### Priority 1: CRITICAL (Blocking Issues)

#### 4.1 Implement e2e.test.ts Tests ⚠️ URGENT

**Requirement:** Implement all 12 TODO tests in `e2e.test.ts`

These tests are **essential** for verifying cross-chain functionality. Cannot deploy without them.

**Estimated Effort:** 2-3 weeks
- Requires Wormhole mock infrastructure
- Requires L1 message injection capability
- Requires Aave mock contracts
- Requires time manipulation for deadline testing

---

#### 4.2 Add claim_refund Test Coverage ⚠️ URGENT

**File:** `integration.test.ts`

**Required Tests:**
```typescript
describe("Refund Flow", () => {
    it("should allow refund after deadline expires");
    it("should reject refund before deadline");
    it("should prevent double refund");
    it("should reject zero current_time");
    it("should generate new nonce for refunded note");
    it("should preserve position details except nonce and status");
});
```

**Estimated Effort:** 2-3 days

---

#### 4.3 Add Deadline Validation Tests ⚠️ URGENT

**File:** `integration.test.ts`

**Required Tests:**
```typescript
describe("Deadline Validation", () => {
    it("should reject deposit with expired deadline");
    it("should reject deposit with zero deadline");
    it("should reject withdrawal with expired deadline");
    it("should reject withdrawal with zero deadline");
    it("should allow operations with future deadlines");
});
```

**Estimated Effort:** 1-2 days

---

#### 4.4 Add Secret Hash Validation Tests ⚠️ URGENT

**File:** `integration.test.ts`

**Required Tests:**
```typescript
describe("Secret Hash Authorization", () => {
    it("should reject finalize_deposit with wrong secret");
    it("should reject finalize_withdraw with wrong secret");
    it("should reject finalize with zero secret");
    it("should reject finalize with secret from different user");
    it("should accept finalize with correct secret");
});
```

**Estimated Effort:** 2-3 days

---

#### 4.5 Strengthen Intent ID Assertions 🔧 HIGH

**Current:**
```typescript
expect(intentIdA).toBeDefined();
expect(intentIdA.toString()).not.toBe("0");
```

**Required:**
```typescript
const expectedIntentId = computeIntentId(
    userAWallet.getAddress(),
    assetId,
    amount,
    decimals,
    chainId,
    deadline,
    salt
);
expect(intentIdA.toString()).toBe(expectedIntentId.toString());
```

**Files to Update:**
- Lines 220-221
- Lines 272-273
- Lines 329-330

**Estimated Effort:** 1 day (need to implement `computeIntentId` helper)

---

#### 4.6 Make Error Assertions Specific 🔧 HIGH

**Current:**
```typescript
).rejects.toThrow(/Position receipt note not found|Not the owner/);
```

**Required:** Each test should know exactly which error should occur:
```typescript
// Test A: PXE-level note discovery failure
).rejects.toThrow(/Position receipt note not found/);

// Test B: Contract-level authorization failure (separate test)
).rejects.toThrow(/Not the owner of this position/);
```

**Files to Update:**
- Lines 244
- Lines 296
- Lines 342
- Lines 374

**Estimated Effort:** 1 day

---

### Priority 2: HIGH (Important for Production)

#### 4.7 Implement Full Cycle Tests 🔨

**Required:**
- Complete deposit flow with L1 message injection
- Complete withdrawal flow with L1 message injection
- Full deposit→withdraw cycle
- Multiple concurrent operations

**Estimated Effort:** 1-2 weeks

---

#### 4.8 Add Amount Edge Case Tests 🔨

**Required:**
- Zero amount deposit/withdrawal
- Max u128 amount
- Over-withdrawal (marked TODO)
- Partial withdrawal (integration test)
- Exact withdrawal

**Estimated Effort:** 2-3 days

---

#### 4.9 Add Chain ID and Asset ID Validation Tests 🔨

**Required:**
- Mismatched asset ID in finalization
- Mismatched chain ID in finalization
- Invalid chain ID rejection
- Zero asset ID handling

**Estimated Effort:** 1-2 days

---

#### 4.10 Add Direct State Verification 🔧

**Current:** Tests check side effects (function failures)
**Required:** Tests should read contract storage directly

**Example:**
```typescript
// Check intent status directly
const status = await contract.methods.view_intent_status(intentId).view();
expect(status).toBe(IntentStatus.PENDING_DEPOSIT);

// Check consumed_intents mapping
const isConsumed = await contract.methods.is_intent_consumed(intentId).view();
expect(isConsumed).toBe(true);
```

**Prerequisite:** May require adding view functions to contract

**Estimated Effort:** 3-5 days

---

### Priority 3: MEDIUM (Quality Improvements)

#### 4.11 Fix Test Infrastructure Workarounds 🔧

**Issue:** Lines 206-224 work around aztec.js race conditions

**Required:**
- Document as known limitation
- File issue with aztec.js if not already reported
- Add comment explaining why workaround is necessary

**Estimated Effort:** 1 day

---

#### 4.12 Add Concurrent Operation Tests 🔨

**Required:**
- Multiple users depositing simultaneously
- Same user creating multiple positions
- Nonce uniqueness verification
- Intent ID collision resistance

**Estimated Effort:** 3-5 days

---

#### 4.13 Add Note Content Verification 🔨

**Required:** After creating notes, verify all fields:
```typescript
// After deposit finalization
const note = await getNoteForUser(intentId);
expect(note.owner).toBe(userAddress);
expect(note.asset_id).toBe(assetId);
expect(note.shares).toBe(expectedShares);
expect(note.target_chain_id).toBe(chainId);
expect(note.aave_market_id).toBe(marketId);
expect(note.status).toBe(PositionStatus.ACTIVE);
```

**Estimated Effort:** 2-3 days

---

#### 4.14 Add Status Transition Tests 🔨

**Required:**
- Test all valid transitions
- Test all invalid transitions (should fail)
- Verify state consistency at each step

**Estimated Effort:** 2-3 days

---

#### 4.15 Add Portal Authorization Tests 🔨

**Required:**
- Verify only authorized portal can send messages
- Test message sender validation
- Test with unauthorized sender (should fail)

**Estimated Effort:** 1-2 days

---

## 5. Test Coverage Matrix

### Integration Tests (`integration.test.ts`)

| Feature | Happy Path | Failure Paths | Edge Cases | Status |
|---------|-----------|---------------|------------|--------|
| `request_deposit` | ⚠️ PARTIAL | ⚠️ PARTIAL | ❌ MISSING | INSUFFICIENT |
| `finalize_deposit` | ⚠️ PARTIAL | ⚠️ PARTIAL | ❌ MISSING | INSUFFICIENT |
| `request_withdraw` | ⚠️ PARTIAL | ⚠️ PARTIAL | ❌ MISSING | INSUFFICIENT |
| `finalize_withdraw` | ⚠️ PARTIAL | ⚠️ PARTIAL | ❌ MISSING | INSUFFICIENT |
| `claim_refund` | ❌ MISSING | ❌ MISSING | ❌ MISSING | **CRITICAL** |
| Authorization | ✅ BASIC | ⚠️ PARTIAL | ❌ MISSING | PARTIAL |
| Replay Protection | ⚠️ INDIRECT | ⚠️ PARTIAL | ❌ MISSING | INSUFFICIENT |
| Balance Validation | ❌ TODO | ❌ TODO | ❌ MISSING | **CRITICAL** |
| Deadline Enforcement | ❌ MISSING | ❌ MISSING | ❌ MISSING | **CRITICAL** |
| Secret Validation | ❌ MISSING | ❌ MISSING | ❌ MISSING | **CRITICAL** |

### E2E Tests (`e2e.test.ts`)

| Feature | Status | Completion |
|---------|--------|------------|
| Full deposit cycle | ❌ TODO | 0% |
| Full withdrawal cycle | ❌ TODO | 0% |
| Deposit→withdraw cycle | ❌ TODO | 0% |
| Expired deadline | ❌ TODO | 0% |
| Replay protection | ❌ TODO | 0% |
| Authorization | ❌ TODO | 0% |
| Concurrent operations | ❌ TODO | 0% |
| Unauthorized source | ❌ TODO | 0% |
| Aave failure handling | ❌ TODO | 0% |
| L1 deadline enforcement | ❌ TODO | 0% |
| Double finalization | ❌ TODO | 0% |
| **Overall E2E Coverage** | ❌ | **0%** |

---

## 6. Comparison with TEST_AUDIT.md Claims

**File:** `/aztec_contracts/TEST_AUDIT.md` (Lines 315-332)

**Claims:**
> ### Priority 1: Critical (Security Impact) ✅ IMPLEMENTED
>
> Tests implemented in `/e2e/src/integration.test.ts` using aztec.js:
>
> 1. **Authorization check tests** ✅
> 2. **Replay protection tests** ✅
> 3. **Balance validation tests** ✅

**Reality Check:**

| Claim | Actual Status | Evidence |
|-------|---------------|----------|
| Authorization tests ✅ | ⚠️ PARTIAL | Only basic case tested, no secret validation |
| Replay protection ✅ | ⚠️ INSUFFICIENT | Indirect testing, vague error expectations |
| Balance validation ✅ | ❌ INCOMPLETE | 2 critical tests marked TODO (lines 411, 423) |

**Discrepancy:** TEST_AUDIT.md overclaims implementation completeness.

---

## 7. Risk Assessment

### Production Deployment Risk: **HIGH ⚠️**

| Risk Category | Severity | Mitigation Status |
|--------------|----------|-------------------|
| Refund mechanism failure | CRITICAL | ❌ UNTESTED |
| Deadline bypass attacks | CRITICAL | ❌ UNTESTED |
| Secret hash bypass | CRITICAL | ❌ UNTESTED |
| Cross-chain flow failures | CRITICAL | ❌ UNTESTED |
| Over-withdrawal attacks | CRITICAL | ❌ TODO |
| Authorization bypass | HIGH | ⚠️ PARTIAL |
| Replay attacks | HIGH | ⚠️ PARTIAL |
| State corruption | HIGH | ⚠️ INDIRECT |

**Recommendation:** Do NOT deploy to production until:
1. All Priority 1 CRITICAL tests are implemented and passing
2. All Priority 2 HIGH tests are implemented and passing
3. E2E test coverage reaches at least 80%
4. All TODO tests are implemented

---

## 8. Estimated Effort Summary

| Priority | Task Category | Estimated Effort | Dependencies |
|----------|--------------|------------------|--------------|
| P1 | Implement e2e.test.ts | 2-3 weeks | Wormhole mocks, L1 infrastructure |
| P1 | claim_refund tests | 2-3 days | None |
| P1 | Deadline validation tests | 1-2 days | None |
| P1 | Secret hash validation tests | 2-3 days | None |
| P1 | Strengthen intent ID assertions | 1 day | Helper function |
| P1 | Make error assertions specific | 1 day | None |
| P2 | Full cycle tests | 1-2 weeks | L1 message injection |
| P2 | Amount edge cases | 2-3 days | None |
| P2 | Chain/Asset ID validation | 1-2 days | None |
| P2 | Direct state verification | 3-5 days | View functions |
| P3 | Test infrastructure fixes | 1 day | aztec.js issue |
| P3 | Concurrent operation tests | 3-5 days | None |
| P3 | Note content verification | 2-3 days | None |
| P3 | Status transition tests | 2-3 days | None |
| P3 | Portal authorization tests | 1-2 days | None |

**Total Estimated Effort:** 5-7 weeks (with parallel work)

---

## 9. Immediate Action Items

### Week 1: Critical Security Gaps

- [ ] Add `claim_refund` test suite (6 tests minimum)
- [ ] Add deadline validation tests (5 tests minimum)
- [ ] Add secret hash validation tests (5 tests minimum)
- [ ] Fix weak intent ID assertions
- [ ] Make error assertions specific

### Week 2-3: Core Functionality

- [ ] Implement basic e2e deposit flow
- [ ] Implement basic e2e withdrawal flow
- [ ] Add over-withdrawal prevention test (currently TODO)
- [ ] Add double withdrawal prevention test (currently TODO)
- [ ] Add amount edge case tests

### Week 4-5: Cross-Chain Integration

- [ ] Complete full e2e test suite with Wormhole mocks
- [ ] Add L1 message injection infrastructure
- [ ] Test full deposit→withdraw cycles
- [ ] Test concurrent operations

### Week 6-7: Quality and Edge Cases

- [ ] Add direct state verification
- [ ] Add note content verification
- [ ] Add status transition tests
- [ ] Add portal authorization tests
- [ ] Comprehensive documentation review

---

## 10. Conclusion

The current e2e test suite is **inadequate for production deployment**. While `integration.test.ts` provides basic smoke testing, it suffers from weak assertions that adapt to code behavior rather than verifying expected behavior. More critically, `e2e.test.ts` is 100% unimplemented, leaving all cross-chain functionality untested.

**Key Findings:**

1. **0% E2E Coverage:** All cross-chain tests are TODO
2. **Critical Features Untested:** `claim_refund`, deadline validation, secret validation
3. **Test Philosophy Violations:** Weak assertions, vague error expectations, indirect verification
4. **Overclaimed Coverage:** TEST_AUDIT.md claims implementation is complete, but critical tests are missing or TODO

**Recommendation:** Allocate 5-7 weeks for comprehensive test implementation before considering production deployment. Focus on Priority 1 CRITICAL items first, as these represent immediate security risks.

---

**Audit Completed:** 2026-01-09
**Auditor:** Claude Code (Automated Analysis)
**Next Review:** After P1 CRITICAL items are implemented
