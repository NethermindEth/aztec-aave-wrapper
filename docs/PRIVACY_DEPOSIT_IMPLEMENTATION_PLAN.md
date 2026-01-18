## Phase 1: L2 Token Infrastructure

Deploy the bridged USDC token contract on L2 that supports burn/mint operations required for the privacy-preserving flow.

### Phase Validation
```bash
cd aztec && aztec test
```

### Step 1: Create L2 BridgedToken contract **COMPLETE**

#### Goal
Create a Noir contract implementing a private token with burn and mint capabilities that can be authorized to the AaveWrapper contract.

#### Files
- `aztec/src/bridged_token.nr` - New bridged token contract with private balance, transfer, burn_private, and mint_private functions
- `aztec/Nargo.toml` - Add bridged_token to contract list

#### Validation
```bash
cd aztec && aztec compile && ls target/aave_wrapper-BridgedToken.json
```

#### Failure modes
- Missing aztec-nr Token dependencies
- Incorrect note encryption patterns
- Storage slot collision with existing contracts

---

### Step 2: Add burn authorization to BridgedToken

#### Goal
Implement an authorization mechanism allowing AaveWrapper to call burn_private on behalf of users during deposit requests.

#### Files
- `aztec/src/bridged_token.nr` - Add authorized_burners storage map and burn_from function callable by authorized contracts

#### Validation
```bash
cd aztec && aztec test --match burn
```

#### Failure modes
- Authorization bypass vulnerabilities
- Incorrect nullifier handling in burn
- Reentrancy in cross-contract call

---

### Step 3: Add mint authorization for refunds

#### Goal
Implement mint_private function that AaveWrapper can call to refund tokens when deposit timeouts occur.

#### Files
- `aztec/src/bridged_token.nr` - Add authorized_minters storage map and mint_to_private function

#### Validation
```bash
cd aztec && aztec test --match mint
```

#### Failure modes
- Unauthorized minting vulnerability
- Double-mint on refund race condition

---

## Phase 2: L1 TokenPortal Deployment

Deploy a TokenPortal contract on L1 that holds USDC and enables L1<->L2 token bridging following the Aztec reference pattern.

### Phase Validation
```bash
cd eth && forge test --match-contract TokenPortalTest
```

### Step 4: Create L1 TokenPortal contract

#### Goal
Implement TokenPortal.sol following Aztec's reference token bridge pattern with depositToAztecPublic, depositToAztecPrivate, and withdraw functions.

#### Files
- `eth/contracts/TokenPortal.sol` - New TokenPortal contract implementing ITokenPortal interface with deposit and withdraw functions

#### Validation
```bash
cd eth && forge build && forge inspect TokenPortal methods
```

#### Failure modes
- Incorrect L1->L2 message encoding for Aztec inbox
- Missing withdraw authorization verification
- Token accounting errors on partial withdrawals

---

### Step 5: Add TokenPortal unit tests

#### Goal
Create comprehensive unit tests for TokenPortal covering deposit, withdraw, and edge cases.

#### Files
- `eth/test/TokenPortal.t.sol` - New test file with deposit/withdraw tests using existing mock infrastructure from Portal.t.sol

#### Validation
```bash
cd eth && forge test --match-contract TokenPortalTest -vvv
```

#### Failure modes
- Insufficient test coverage for edge cases
- Mock dependencies not matching real Aztec inbox/outbox behavior

---

### Step 6: Add withdraw function to TokenPortal

#### Goal
Implement the withdraw function that allows the AavePortal to claim tokens from TokenPortal after L2 burn message consumption.

#### Files
- `eth/contracts/TokenPortal.sol` - Add withdraw(amount, recipient, l2BlockNumber, leafIndex, siblingPath) function that consumes L2->L1 message

#### Validation
```bash
cd eth && forge test --match-test test_withdraw -vvv
```

#### Failure modes
- Withdraw without valid L2->L1 burn message
- Double-withdraw on same message
- Reentrancy during token transfer

---

## Phase 3: AaveWrapper L2 Contract Updates

Modify the L2 AaveWrapper to burn tokens instead of expecting L1 transfers, implementing the new privacy-preserving deposit flow.

### Phase Validation
```bash
cd aztec && aztec test
```

### Step 7: Add token and treasury references to AaveWrapper storage

#### Goal
Add storage for the bridged token contract address and fee treasury address that AaveWrapper will interact with.

#### Files
- `aztec/src/main.nr` - Add `bridged_token: PublicImmutable<AztecAddress>` and `fee_treasury: PublicImmutable<AztecAddress>` to Storage struct at line 270
- `aztec/src/main.nr` - Update constructor at line 320 to accept and store bridged_token and fee_treasury addresses

#### Validation
```bash
cd aztec && aztec compile
```

#### Failure modes
- Breaking change to existing constructor signature in tests
- Storage slot collision with existing fields

---

### Step 8: Modify request_deposit to burn L2 tokens

#### Goal
Update request_deposit at line 372 to burn the user's L2 tokens via the BridgedToken contract instead of expecting tokens on L1.

#### Files
- `aztec/src/main.nr` - In request_deposit: import BridgedToken, call bridged_token.burn_from(caller, net_amount) before sending L2->L1 message

#### Validation
```bash
cd aztec && aztec test --match request_deposit
```

#### Failure modes
- Burn fails but L2->L1 message still sent (atomicity broken)
- Insufficient user balance not caught before burn attempt
- Cross-contract call reverts silently

---

### Step 9: Add fee deduction logic

#### Goal
Implement fixed percentage fee deduction (0.1% = 10 basis points) from deposit amount before burning, with fee tokens transferred to protocol treasury.

#### Files
- `aztec/src/main.nr` - Add FEE_BASIS_POINTS constant (10 = 0.1%)
- `aztec/src/main.nr` - In request_deposit: calculate fee = amount * FEE_BASIS_POINTS / 10000, net_amount = amount - fee
- `aztec/src/main.nr` - Transfer fee to treasury via bridged_token.transfer_from(caller, treasury, fee)

#### Validation
```bash
cd aztec && aztec test --match fee
```

#### Failure modes
- Fee rounding errors causing locked dust
- Zero net_amount not rejected (amount < 100 tokens)
- Fee bypass by manipulating amount

---

### Step 10: Implement cancel_deposit for timeout refunds

#### Goal
Add cancel_deposit function allowing users to reclaim tokens if L1 execution never happens after deadline passes.

#### Files
- `aztec/src/main.nr` - Add cancel_deposit(intent_id: Field, current_time: u64) function that:
  1. Verifies caller owns intent via intent_owners mapping
  2. Verifies deadline has passed (current_time > intent_deadlines[intent_id])
  3. Verifies intent status is still PENDING_DEPOSIT
  4. Mints net_amount back to user via bridged_token.mint_to_private
  5. Sets intent status to CANCELLED (new status constant = 5)

#### Validation
```bash
cd aztec && aztec test --match cancel_deposit
```

#### Failure modes
- Cancel allowed after L1 execution started
- Double-cancel mints tokens twice
- Incorrect deadline comparison (no block.timestamp on L2)

---

### Step 11: Store deposit amount for cancel refunds

#### Goal
Add storage to track the net deposit amount per intent so cancel_deposit can mint back the correct amount.

#### Files
- `aztec/src/main.nr` - Add `intent_amounts: Map<Field, PublicMutable<u128>>` to Storage struct
- `aztec/src/main.nr` - In request_deposit: store intent_amounts[intent_id] = net_amount
- `aztec/src/main.nr` - In cancel_deposit: read and use stored amount for mint

#### Validation
```bash
cd aztec && aztec test --match cancel
```

#### Failure modes
- Amount not stored atomically with intent creation
- Amount cleared before cancel check

---

## Phase 4: AavePortal L1 Contract Updates

Modify the L1 portal to claim tokens from TokenPortal instead of expecting pre-transferred tokens.

### Phase Validation
```bash
cd eth && forge test --match-contract PortalTest -vv
```

### Step 12: Update AavePortal to claim tokens from TokenPortal

#### Goal
Modify executeDeposit at line 182 to claim tokens from TokenPortal based on L2 burn authorization instead of expecting tokens pre-transferred to portal.

#### Files
- `eth/contracts/AztecAavePortalL1.sol` - In executeDeposit after message consumption: add call to ITokenPortal(tokenPortal).withdraw(intent.amount, address(this))

#### Validation
```bash
cd eth && forge test --match-test test_executeDeposit -vvv
```

#### Failure modes
- TokenPortal withdraw fails but deposit continues with zero tokens
- Incorrect amount claimed (should match intent.amount)
- TokenPortal doesn't have sufficient balance

---

### Step 13: Remove pre-funded token expectation from tests

#### Goal
Update Portal.t.sol tests to not pre-fund portal with tokens, instead configure TokenPortal with sufficient balance.

#### Files
- `eth/test/Portal.t.sol` - Remove line 92 `token.mint(address(portal), 10_000e18)`
- `eth/test/Portal.t.sol` - Add token.mint(address(tokenPortal), ...) in setUp
- `eth/test/Portal.t.sol` - Configure MockTokenPortal to return tokens on withdraw

#### Validation
```bash
cd eth && forge test --match-contract PortalTest -vvv
```

#### Failure modes
- Tests fail due to token balance changes
- MockTokenPortal not implementing withdraw properly

---

### Step 14: Update MockTokenPortal with withdraw function

#### Goal
Extend MockTokenPortal in Portal.t.sol to support withdraw function for testing.

#### Files
- `eth/test/Portal.t.sol` - Add withdraw(uint256 amount, address recipient) to MockTokenPortal at line 765
- `eth/test/Portal.t.sol` - Add token storage and transfer logic to mock

#### Validation
```bash
cd eth && forge test --match-contract PortalTest -vvv
```

#### Failure modes
- Mock doesn't match real TokenPortal interface
- Token transfer in mock fails

---

## Phase 5: Message Content Updates

Update L2->L1 deposit message to work with the new burn-based flow.

### Phase Validation
```bash
make test
```

### Step 15: Verify message hash compatibility

#### Goal
Ensure the L2->L1 deposit message hash computation in Noir matches what Solidity expects after the flow change.

#### Files
- `aztec/src/main.nr` - Review compute_deposit_message_content at line 66
- `eth/contracts/types/Intent.sol` - Review hashDepositIntent at line 56

#### Validation
```bash
make test-l1 && make test-l2
```

#### Failure modes
- Hash mismatch between L1 and L2 after changes
- Field ordering differences in struct serialization

---

### Step 16: Update DepositIntent to include burn context

#### Goal
Add burn_amount field to DepositIntent if needed for TokenPortal withdraw authorization.

#### Files
- `aztec/src/types/intent.nr` - Consider if burn_amount or burn_nonce field needed
- `eth/contracts/types/Intent.sol` - Add corresponding field if needed
- `eth/contracts/AztecAavePortalL1.sol` - Update hashDepositIntent usage

#### Validation
```bash
make build && make test
```

#### Failure modes
- Serialization mismatch between Noir and Solidity
- Hash computation differences break message verification

---

## Phase 6: Integration Testing

Create end-to-end tests validating the complete privacy-preserving deposit flow.

### Phase Validation
```bash
make e2e
```

### Step 17: Update deployment script for TokenPortal

#### Goal
Update deploy-local.ts to deploy real TokenPortal instead of mock and configure with MockUSDC.

#### Files
- `scripts/deploy-local.ts` - Replace MockTokenPortal deployment at line 479 with real TokenPortal
- `scripts/deploy-local.ts` - Configure TokenPortal with MockUSDC address and Aztec inbox/outbox

#### Validation
```bash
make devnet-up && bun run scripts/deploy-local.ts
```

#### Failure modes
- TokenPortal constructor args incorrect
- Deployment order dependencies (need inbox/outbox first)

---

### Step 18: Deploy BridgedToken in test setup

#### Goal
Deploy BridgedToken on L2 in e2e test harness and register with test accounts.

#### Files
- `e2e/src/setup.ts` - Add BridgedToken deployment in deployContracts at line 494
- `e2e/src/setup.ts` - Register BridgedToken with user wallets
- `e2e/src/generated/BridgedToken.ts` - Generate TypeScript bindings (via aztec codegen)

#### Validation
```bash
cd e2e && bun run test --match setup
```

#### Failure modes
- BridgedToken compilation failed
- Missing TypeScript bindings

---

### Step 19: Create bridge helper for E2E tests

#### Goal
Create test helper function for bridging USDC from L1 to L2 as prerequisite for deposit tests.

#### Files
- `e2e/src/flows/bridge.ts` - New file with bridgeToL2(wallet, amount, secretHash) function that:
  1. Approves TokenPortal for USDC
  2. Calls TokenPortal.depositToAztecPrivate
  3. Waits for L1->L2 message
  4. Claims tokens on L2 via BridgedToken
- `e2e/src/flows/index.ts` - Export bridge flow

#### Validation
```bash
cd e2e && bun run test --match bridge
```

#### Failure modes
- L1->L2 message timing issues
- Token claim on L2 fails

---

### Step 20: Update E2E deposit test for new flow

#### Goal
Update the main E2E deposit test to use bridged L2 tokens instead of L1 direct transfer.

#### Files
- `e2e/src/e2e.test.ts` - Update test at line 221:
  1. Bridge USDC to L2 first (new prerequisite step)
  2. Call request_deposit (now burns L2 tokens)
  3. Execute on L1 (claims from TokenPortal)
  4. Finalize on L2 (unchanged)
- `e2e/src/flows/deposit.ts` - Update helpers if needed

#### Validation
```bash
make e2e
```

#### Failure modes
- Bridge step adds timing complexity
- Token balance assertions need updating

---

### Step 21: Add cancel/refund E2E test

#### Goal
Create E2E test for the timeout refund flow when L1 execution doesn't happen.

#### Files
- `e2e/src/e2e.test.ts` - Add new test case:
  1. Bridge USDC to L2
  2. Call request_deposit
  3. Advance time past deadline (use advanceChainTime helper)
  4. Call cancel_deposit
  5. Verify tokens returned to user

#### Validation
```bash
cd e2e && bun run test --match cancel
```

#### Failure modes
- Time manipulation doesn't affect L2 deadline check
- Refund amount doesn't match (fee already deducted)

---

## Phase 7: Cleanup and Documentation

Remove legacy flow and update documentation.

### Phase Validation
```bash
make test && make e2e
```

### Step 22: Remove L1 direct token transfer code paths

#### Goal
Remove code and comments in AavePortal that reference the old flow where tokens were pre-transferred to portal.

#### Files
- `eth/contracts/AztecAavePortalL1.sol` - Remove/update comments about token pre-transfer
- `eth/test/Portal.t.sol` - Ensure no tests rely on pre-funded portal

#### Validation
```bash
cd eth && forge test -vv
```

#### Failure modes
- Removing code that's still needed
- Breaking test assumptions

---

### Step 23: Update existing documentation

#### Goal
Update DEPOSIT_TRANSACTION_FLOW.md to reflect the new privacy-preserving flow.

#### Files
- `docs/DEPOSIT_TRANSACTION_FLOW.md` - Replace TX #2 (Approve) and TX #3 (Transfer) with bridge prerequisite
- `docs/DEPOSIT_TRANSACTION_FLOW.md` - Update ASCII diagram to show burn instead of L1 transfer

#### Validation
```bash
grep -q "burn" docs/DEPOSIT_TRANSACTION_FLOW.md
```

#### Failure modes
- Documentation inconsistent with implementation

---

### Step 24: Update CLAUDE.md

#### Goal
Update CLAUDE.md with new deposit flow description for future development reference.

#### Files
- `CLAUDE.md` - Update Cross-Chain Message Flow section with privacy-preserving deposit flow
- `CLAUDE.md` - Add TokenPortal and BridgedToken to Key Files section

#### Validation
```bash
grep -q "TokenPortal" CLAUDE.md && grep -q "burn" CLAUDE.md
```

#### Failure modes
- Documentation doesn't match actual implementation

---
