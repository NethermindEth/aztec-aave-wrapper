Plan grounded in code locations and current behavior.

`★ Insight ─────────────────────────────────────`
**Key Findings from Codebase Exploration:**
1. **Bug Confirmed**: `request_deposit` validates `deadline > 0` (line 506) but `request_withdraw` has no such check - a `deadline=0` withdraw would pass L2 but fail on L1 with `DeadlinePassed`. `_request_withdraw_public` is externally callable and currently accepts any deadline.
2. **Unused in Production**: `compute_withdraw_confirmation_content` is defined around line 186 but never called in production code; it is used only in tests. The `finalize_withdraw` function was removed per comment at lines 884-886.
3. **Owner Hash Computation**: `owner_hash` is currently `poseidon2_hash([owner/caller])` in both flows. Making it per-intent requires a guaranteed-unique input (e.g., `intent_id`), not just `salt` which is derived from `secret_hash` and may be reused.
`─────────────────────────────────────────────────`

## Phase 1: Bug Fix - Missing Deadline Validation **COMPLETE**

Add deadline validation to both `request_withdraw` and `_request_withdraw_public` to prevent zero-deadline intents from being stored or bypassing the private check.

### Phase Validation
```bash
cd aztec && aztec test
```

### Step 1: Add deadline validation to request_withdraw and _request_withdraw_public **COMPLETE**

#### Goal
Add `assert(deadline > 0)` check to `request_withdraw` and `_request_withdraw_public` to prevent stuck intents and to avoid bypassing the private check via the public entrypoint.

#### Files
- `aztec/aave_wrapper/src/main.nr` - Add assertion after line 774 (after `let owner = self.msg_sender().unwrap();`)
- `aztec/aave_wrapper/src/main.nr` - Add assertion at top of `_request_withdraw_public`

#### Validation
```bash
cd aztec && aztec test && rg -n "request_withdraw\\(|_request_withdraw_public" aave_wrapper/src/main.nr && rg -n "deadline > 0" aave_wrapper/src/main.nr
```

#### Failure modes
- Assertion text doesn't match the deposit version style
- Line insertion breaks existing indentation or formatting

---

### Step 2: Add test coverage for deadline=0 rejection via a minimal harness **COMPLETE**

#### Goal
Create a minimal test harness that calls `request_withdraw` and `_request_withdraw_public` with `deadline=0` and asserts failure. If adding a harness is out of scope, document that the contract-call path is untested in Noir and leave a TODO.

#### Files
- `aztec/aave_wrapper/src/test/withdraw_tests.nr` - Add new test function `test_request_withdraw_zero_deadline_fails` if a harness exists
- `aztec/aave_wrapper/src/test` - Add a minimal harness if needed (new file if required)

#### Validation
```bash
cd aztec && aztec test
```

#### Failure modes
- Test framework doesn't support assertion failure testing
- Test name conflicts with existing tests

---

## Phase 2: Enhancement - Per-Intent Owner Hash

Modify owner hash computation to include a guaranteed-unique input (intent_id), reducing cross-intent linkability. Using `salt` alone is insufficient because it depends on `secret_hash`, which may be reused.

### Phase Validation
```bash
cd aztec && aztec compile && aztec test
```

### Step 3: Derive owner_hash from intent_id in request_deposit **COMPLETE**

#### Goal
Compute `intent_id` first, then set `owner_hash = poseidon2_hash([caller.to_field(), intent_id])` (or equivalent) so owner_hash is per-intent.

#### Files
- `aztec/aave_wrapper/src/main.nr` - Reorder computation to compute `intent_id` before `owner_hash`

#### Validation
```bash
cd aztec && aztec compile && rg -n "intent_id" aave_wrapper/src/main.nr && rg -n "owner_hash = poseidon2_hash" aave_wrapper/src/main.nr
```

#### Failure modes
- Salt variable used before its current declaration point (requires careful ordering)
- Comment references become stale after reordering

---

### Step 4: Update owner_hash computation in request_deposit to use intent_id **COMPLETE**

#### Goal
Change `owner_hash = poseidon2_hash([caller.to_field()])` to `poseidon2_hash([caller.to_field(), intent_id])` for per-intent unlinkability.

#### Files
- `aztec/aave_wrapper/src/main.nr` - Update poseidon2_hash call to include intent_id

#### Validation
```bash
cd aztec && aztec compile && rg -n "owner_hash = poseidon2_hash\\(\\[caller.to_field\\(\\), intent_id\\]\\)" aave_wrapper/src/main.nr
```

#### Failure modes
- Hash output format changes (still a Field, but different value for same inputs)
- Existing tests that rely on deterministic owner_hash values will need updates

---

### Step 5: Update owner_hash computation in request_withdraw to use intent_id **COMPLETE**

#### Goal
Change `owner_hash = poseidon2_hash([owner.to_field()])` to `poseidon2_hash([owner.to_field(), intent_id])` for per-intent unlinkability.

#### Files
- `aztec/aave_wrapper/src/main.nr` - Line 822: Update poseidon2_hash call to include intent_id (which is receipt.nonce, already available at line 802)

#### Validation
```bash
cd aztec && aztec compile && grep "owner_hash = poseidon2_hash" aave_wrapper/src/main.nr | grep -q "intent_id"
```

#### Failure modes
- intent_id must be computed before owner_hash (already the case, line 802 vs 822)
- Cross-chain message verification on L1 receives owner_hash as a value, not recomputed, so L1 changes are not required

---

### Step 6: Update comments for owner_hash computation **COMPLETE**

#### Goal
Update code comments to document that owner_hash is derived from intent_id for per-intent unlinkability.

#### Files
- `aztec/aave_wrapper/src/main.nr` - Update comments near lines 518 and 822 to explain the salt/intent_id inclusion

#### Validation
```bash
grep -A2 "Compute hash of owner for privacy" aztec/aave_wrapper/src/main.nr | grep -q "per-intent\|unlinkab\|salt\|intent_id"
```

#### Failure modes
- Comments become inconsistent between deposit and withdraw flows
- Comments exceed line length limits if too verbose

---

### Step 7: Add unit test for owner_hash uniqueness across intents (or add helper) **COMPLETE**

#### Goal
Create tests verifying that the same user gets different owner_hash values for different intents. If contract-call tests are unavailable, add a pure helper function (e.g., `compute_owner_hash(owner, intent_id)`) and test that directly.

#### Files
- `aztec/aave_wrapper/src/test/deposit_tests.nr` - Add test `test_owner_hash_unique_per_intent`
- `aztec/aave_wrapper/src/test/withdraw_tests.nr` - Add test `test_withdraw_owner_hash_unique_per_intent`

#### Validation
```bash
cd aztec && aztec test --match "owner_hash_unique"
```

#### Failure modes
- Test relies on internal function access that isn't exported
- Test doesn't accurately simulate multiple intents from same user

---

## Phase 3: Code Cleanup - Dead Code Annotation

Annotate unused `compute_withdraw_confirmation_content` function to clarify its purpose.

### Phase Validation
```bash
cd aztec && aztec compile && aztec test
```

### Step 8: Add comment to compute_withdraw_confirmation_content

#### Goal
Add a short comment that the function is currently unused in production and exercised by tests.

#### Files
- `aztec/aave_wrapper/src/main.nr` - Lines 186-215: Add `// NOTE: Unused in production; exercised in tests.` comment above the function

#### Validation
```bash
rg -n "compute_withdraw_confirmation_content" aztec/aave_wrapper/src/main.nr && rg -n "Unused in production" aztec/aave_wrapper/src/main.nr
```

#### Failure modes
- Comment style inconsistent with rest of codebase
- Removal would be preferable but breaks test imports

---

## Phase 4: Final Verification

Run full test suite and verify all changes work together.

### Phase Validation
```bash
make test && make build
```

### Step 9: Run L2 full test suite

#### Goal
Verify all Noir tests pass with the changes.

#### Files
- No file changes - verification only

#### Validation
```bash
cd aztec && aztec test
```

#### Failure modes
- Tests that relied on deterministic owner_hash values across intents may fail
- Compilation warnings or errors from new code

---

### Step 10: Run L1 test suite

#### Goal
Verify L1 Solidity tests still pass (L1 receives owner_hash as value, doesn't recompute it, so no L1 changes needed).

#### Files
- No file changes - verification only

#### Validation
```bash
cd eth && forge test -vv
```

#### Failure modes
- Integration tests may use hardcoded owner_hash values
- No actual failures expected since L1 doesn't compute owner_hash

---

### Step 11: Build all contracts

#### Goal
Verify both L1 and L2 contracts compile successfully.

#### Files
- No file changes - verification only

#### Validation
```bash
make build
```

#### Failure modes
- Compilation errors from syntax issues
- Linking errors from import changes

---
