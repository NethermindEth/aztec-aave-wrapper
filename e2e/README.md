# E2E Test Suite for Aztec Aave Wrapper

## System Overview

This test suite validates the complete Aztec Aave Wrapper flow: privacy-preserving deposits and withdrawals from Aztec L2 through L1 Portal to Target Chain (Aave). Tests cover the full L2 → L1 → Target → L1 → L2 cycle for both deposit and withdrawal operations.

**Boundaries:**
- **In scope**: L2 contract behavior, cross-chain message flow simulation, privacy properties, security assertions
- **Out of scope**: Real Wormhole guardian signatures, real Aave pool interactions (mocked), L1 contract execution (simulated)

**Entry points:**
- `src/e2e.test.ts:86` - Main E2E test suite
- `src/integration.test.ts:81` - Priority 1 security tests
- `src/setup.test.ts:1` - Infrastructure validation tests
- `src/helpers.test.ts:1` - Unit tests for helper functions

## Core Components

| Component | Location | Responsibility |
|-----------|----------|----------------|
| E2E Tests | `src/e2e.test.ts` | Full deposit/withdraw flow validation |
| Integration Tests | `src/integration.test.ts` | Critical security assertions |
| Test Harness | `src/setup.ts:136-609` | Environment setup, accounts, contracts |
| Deposit Flow | `src/flows/deposit.ts:172-468` | Deposit orchestration (6 steps) |
| Withdraw Flow | `src/flows/withdraw.ts:167-488` | Withdraw orchestration (5 steps) |
| Wormhole Mock | `src/utils/wormhole-mock.ts:344-577` | Cross-chain message simulation |
| Aztec Helpers | `src/utils/aztec.ts:89-200` | PXE interaction utilities |
| Assertions | `src/helpers/assertions.ts:1-231` | Custom security assertions |
| Configuration | `src/config.ts:1-256` | Environment/chain configuration |

## User Workflows Tested

### 1. Full Deposit Flow (`e2e.test.ts:257-396`)

Complete deposit cycle as specified in spec.md §4.1:

```
Step 1: User prepares deposit (secret, deadline)
Step 2: Verify user ≠ relayer (privacy property)
Step 3: L2 request_deposit() → creates DepositIntent, L2→L1 message
Step 4: Verify L2→L1 message created
Step 5: L1 portal execution (relayer, not user)
Step 6: Target chain Aave supply (via Wormhole mock)
Step 7: Confirmation back to L1
Step 8: Privacy verification (relayer ≠ user)
Step 9: L2 finalize_deposit() → creates PositionReceiptNote
```

**Key Assertions:**
- `assertIntentIdNonZero()` - Intent ID validity (`e2e.test.ts:294`)
- `assertDeadlineInFuture()` - Deadline validation (`e2e.test.ts:268`)
- `verifyRelayerPrivacy()` - Privacy property check (`e2e.test.ts:361-370`)

### 2. Full Withdrawal Flow (`e2e.test.ts:485-690`)

Complete withdrawal cycle as specified in spec.md §4.2:

```
Step 1: Setup - Complete deposit first (position required)
Step 2: User prepares withdrawal (secret, deadline)
Step 3: L2 request_withdraw() → consumes receipt, creates L2→L1 message
Step 4: Verify L2→L1 message created
Step 5: L1 portal execution (relayer)
Step 6: Target chain Aave withdrawal (via Wormhole mock)
Step 7: Token bridge back to L1, confirmation
Step 8: Privacy verification
Step 9: L2 finalize_withdraw() → nullifies pending note
```

### 3. Multi-User Concurrent Operations (`e2e.test.ts:779-1158`)

| Test | Location | Validates |
|------|----------|-----------|
| Unique intent IDs (different users) | `e2e.test.ts:789-853` | No ID collision across users |
| Unique intent IDs (same user) | `e2e.test.ts:864-939` | Salt generation prevents collision |
| Position isolation | `e2e.test.ts:949-995` | Users cannot access others' notes |
| State consistency | `e2e.test.ts:1005-1077` | Atomicity during concurrent ops |
| Share tracking isolation | `e2e.test.ts:1087-1157` | Per-user balance separation |

### 4. Privacy Properties (`e2e.test.ts:1164-1235`)

| Test | Location | Validates |
|------|----------|-----------|
| Relayer privacy | `e2e.test.ts:1169-1205` | L1/Target executor ≠ L2 user |
| OwnerHash encoding | `e2e.test.ts:1210-1235` | Hash(owner) sent, not address |

## Edge Cases Covered

### Authorization (`integration.test.ts:191-298`)

| Edge Case | Test Location | Expected Error |
|-----------|---------------|----------------|
| Cross-user withdrawal | `integration.test.ts:192-245` | `Position receipt note not found` |
| Cross-user finalization | `integration.test.ts:247-297` | `Pending withdraw receipt note not found` |

### Replay Protection (`integration.test.ts:304-392`, `e2e.test.ts:434-464`)

| Edge Case | Test Location | Expected Error |
|-----------|---------------|----------------|
| Intent consumed twice | `e2e.test.ts:434-464` | `Intent ID already consumed` |
| Double finalization | `integration.test.ts:345-375` | `Intent not in pending deposit state` |
| Non-pending finalization | `integration.test.ts:377-391` | `Intent not in pending deposit state` |

### Deadline Validation (`e2e.test.ts:401-428`, `e2e.test.ts:696-722`)

| Edge Case | Test Location | Expected Error |
|-----------|---------------|----------------|
| Expired deposit deadline | `e2e.test.ts:401-428` | `Deadline expired\|Deadline must be in the future` |
| Expired withdrawal deadline | `e2e.test.ts:696-722` | `Deadline expired\|Deadline must be in the future\|Position receipt note not found` |

### Receipt Validation (`e2e.test.ts:728-752`)

| Edge Case | Test Location | Expected Error |
|-----------|---------------|----------------|
| Withdrawal without receipt | `e2e.test.ts:728-752` | `Position receipt note not found` |

### Refund Flow (`e2e.test.ts:1241-1457`)

| Edge Case | Test Location | Expected Error |
|-----------|---------------|----------------|
| Refund before deadline | `e2e.test.ts:1250-1278` | `Pending withdraw receipt note not found\|Deadline has not expired yet` |
| Zero current_time | `e2e.test.ts:1402-1421` | `Current time must be greater than zero` |
| Non-PendingWithdraw status | `e2e.test.ts:1427-1457` | `Pending withdraw receipt note not found\|Position is not pending withdrawal` |
| Nonce generation | `e2e.test.ts:1324-1355` | Verifies unique nullifiers |
| Repeated refund claims | `e2e.test.ts:1368-1396` | Note not found after first claim |

## Uncovered Edge Cases (TODOs)

### Marked as `it.todo()` in Test Suite

| Edge Case | Location | Reason Uncovered |
|-----------|----------|------------------|
| Deposit → withdraw cycle | `e2e.test.ts:764` | Full cycle test |
| Multiple concurrent deposits | `e2e.test.ts:772` | Stress test |
| Unauthorized message source | `e2e.test.ts:1470` | Requires L1 contract testing |
| Aave supply failure | `e2e.test.ts:1477` | Requires Aave pool mock/pause |
| Deadline on L1 execution | `e2e.test.ts:1484` | Requires L1 time manipulation |
| Double finalization (full E2E) | `e2e.test.ts:1491` | Requires full L1+L2 flow |

### Balance Validation (Requires L1 Message Injection)

| Edge Case | Location | Status |
|-----------|----------|--------|
| Withdrawal exceeds shares | `integration.test.ts:411` | TODO - requires L1→L2 message |
| Double withdrawal | `integration.test.ts:423` | TODO - requires L1→L2 message |

### Not Currently Testable in Mock Mode

1. **Real L1→L2 message consumption**: Mock mode cannot create real Aztec inbox messages
2. **Real Wormhole VAA validation**: Uses mock VAAs without guardian signatures
3. **Real Aave pool interaction**: Target executor uses simulated pool
4. **L1 contract deadline enforcement**: Would require deployed L1 contracts
5. **Gas estimation accuracy**: Mock transactions don't have real gas costs

## Invariants Enforced

```
### Contract Invariants (helpers/assertions.ts:174-198)
- Intent ID ≠ 0 for all valid intents
- Intent status ∈ {PendingDeposit, Confirmed, PendingWithdraw, Consumed}
- Intent consumed once (replay protection)
- Deadline > current_time for new intents
- Position notes only visible to owner
- OwnerHash = poseidon2Hash([owner]) - never reveals address
```

### Security Invariants Tested

| Invariant | Enforced At | Test Coverage |
|-----------|-------------|---------------|
| User isolation | `main.nr` note ownership | `e2e.test.ts:949-995` |
| Replay protection | `main.nr` intent status | `e2e.test.ts:434-464` |
| Privacy (ownerHash) | `main.nr` message encoding | `e2e.test.ts:1210-1235` |
| Deadline validation | `main.nr` request functions | `e2e.test.ts:401-428` |

## Test Configuration

### Local Configuration (`config.ts:89-126`)

```typescript
{
  pxeConnection: 30_000ms,
  deployment: 60_000ms,
  transaction: 30_000ms,
  crossChain: 120_000ms,
  defaultDeposit: 1_000_000n (1 USDC),
  smallDeposit: 100n,
  largeDeposit: 1_000_000_000n (1000 USDC)
}
```

### Testnet Configuration (`config.ts:131-170`)

```typescript
{
  l1: Sepolia (chain ID 11155111),
  target: Arbitrum Sepolia (chain ID 421614),
  timeouts: 60s PXE, 120s deployment, 300s cross-chain
}
```

## Running Tests

```bash
# All tests
bun run test

# Unit tests only (no devnet required)
bun run test:unit

# Mock tests (local devnet with mock Wormhole)
bun run test:mock

# Integration tests (real Wormhole testnet)
bun run test:integration

# Setup infrastructure tests
bun run test:setup

# Watch mode
bun run test:watch
```

### Prerequisites

1. Local devnet running: `docker compose up`
2. Contracts compiled: `cd aztec_contracts && aztec compile`
3. Node.js v20 or v22 (v23+ has breaking import syntax changes)

## Possible Enhancements

### Priority 1: Complete TODO Tests

1. **Full deposit → withdraw cycle test**
   - Requires: Real L1→L2 message processing
   - Approach: Deploy actual Aztec inbox mock or use testnet

2. **L1 contract deadline enforcement**
   - Requires: Deployed L1 portal contract
   - Approach: Add Foundry tests for `AztecAavePortalL1.sol`

3. **Aave supply failure handling**
   - Requires: Mock Aave pool that can be paused
   - Approach: Add failure injection to `AaveExecutorTarget.sol` tests

### Priority 2: Security Hardening

1. **Balance validation tests with L1 message injection**
   - Test: Withdrawal exceeding shares rejected
   - Test: Double withdrawal rejected
   - Approach: Create mock L1→L2 message sender

2. **Unauthorized message source rejection**
   - Test: L1 portal rejects messages from non-L2 contract
   - Approach: Add L1 Foundry test

3. **Fuzz testing for intent ID generation**
   - Verify no collisions with random inputs
   - Add property-based tests using fast-check

### Priority 3: Performance & Stress Testing

1. **Concurrent operation stress tests**
   - 10+ users creating deposits simultaneously
   - Verify no race conditions in state machine

2. **Large position tests**
   - Deposits near uint256 max
   - Verify no overflow in share calculations

3. **Timeout edge cases**
   - Transaction confirmation timeouts
   - PXE connection recovery

### Priority 4: Testnet Integration

1. **Wormhole testnet VAA validation**
   - Use real Wormhole testnet guardians
   - Verify actual VAA structure and signatures

2. **Aave testnet integration**
   - Deploy to Sepolia/Arbitrum Sepolia
   - Test real Aave pool supply/withdraw

3. **End-to-end testnet flow**
   - Complete flow with real cross-chain messages
   - Measure actual latency and costs

## Open Questions

- `[UNCLEAR]` How to test L1→L2 message consumption without full Aztec devnet L1 integration?
- `[INFERRED]` Mock mode limitations prevent testing finalize_* functions fully
- `[INFERRED]` Privacy verification uses placeholder addresses since Aztec↔Ethereum addresses aren't convertible

## Contract Error Constants

Reference for expected error messages (`helpers/assertions.ts:174-198`):

```typescript
CONTRACT_ERRORS = {
  POSITION_NOT_FOUND: "Position receipt note not found",
  PENDING_WITHDRAW_NOT_FOUND: "Pending withdraw receipt note not found",
  NOT_THE_OWNER: "Not the owner",
  INTENT_ALREADY_CONSUMED: "Intent ID already consumed",
  INTENT_NOT_PENDING_DEPOSIT: "Intent not in pending deposit state",
  INTENT_NOT_PENDING_WITHDRAW: "Intent not in pending withdraw state",
  WITHDRAWAL_EXCEEDS_SHARES: "Withdrawal amount exceeds available shares",
  POSITION_NOT_ACTIVE: "Position is not active",
  DEADLINE_EXPIRED: "Deadline expired",
  DEADLINE_ZERO: "Deadline must be greater than zero",
  INVALID_SECRET: "Invalid secret",
  INVALID_STATUS_TRANSITION: "Invalid status transition"
}
```
