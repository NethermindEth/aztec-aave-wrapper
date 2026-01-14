# Implementation Notes

This document captures implementation decisions, deviations from the original specification, architectural insights, and lessons learned during development of the Aztec Aave Wrapper.

**Created**: 2026-01-13
**Last Updated**: 2026-01-13

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Privacy Model](#privacy-model)
3. [Cross-Chain Message Flow](#cross-chain-message-flow)
4. [Key Implementation Decisions](#key-implementation-decisions)
5. [Deviations from Specification](#deviations-from-specification)
6. [Known Limitations](#known-limitations)
7. [Gotchas for Future Developers](#gotchas-for-future-developers)
8. [Testing Strategy](#testing-strategy)

---

## Architecture Overview

The implementation follows a three-layer architecture based on the "Aztec Uniswap L1-from-L2 tutorial pattern":

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           AZTEC L2 (Noir)                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  AaveWrapper Contract                                            │   │
│  │  - Private intent creation (request_deposit, request_withdraw)   │   │
│  │  - Private note management (PositionReceiptNote)                 │   │
│  │  - Intent status tracking (intent_status mapping)                │   │
│  │  - Owner resolution (intent_owners mapping)                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ L2→L1 Messages (via Aztec Outbox)
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        ETHEREUM L1 (Solidity)                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  AztecAavePortalL1 Contract                                      │   │
│  │  - Consumes Aztec L2→L1 messages                                 │   │
│  │  - Validates deadlines (min 5 min, max 24 hours)                 │   │
│  │  - Bridges tokens via Wormhole TokenBridge                       │   │
│  │  - Receives confirmations from Target executor                   │   │
│  │  - Sends L1→L2 finalization messages                             │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ Wormhole (Token+Payload / Payload-only)
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      TARGET CHAIN (Solidity)                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  AaveExecutorTarget Contract                                     │   │
│  │  - Verifies Wormhole VAAs                                        │   │
│  │  - Denormalizes token amounts                                    │   │
│  │  - Executes Aave supply/withdraw operations                      │   │
│  │  - Tracks per-intent shares and position values                  │   │
│  │  - Maintains retry queue for failed operations                   │   │
│  │  - Sends confirmations back to L1 portal                         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

| Layer | Responsibility | Privacy Role |
|-------|---------------|--------------|
| L2 (Noir) | Intent creation, note management, owner mapping | Full privacy - encrypted notes, no public identity |
| L1 Portal | Message relay, token bridging, deadline enforcement | Partial - sees intent details but not owner identity |
| Target | Aave operations, share tracking, yield calculation | No privacy - operates on intent data only |

---

## Privacy Model

### Dual Privacy Mechanisms

The implementation uses two complementary privacy mechanisms:

#### 1. hash(ownerL2) - Owner Identity Protection

The L2 owner address is never sent in plain form across chains. Instead:

```noir
// In L2 contract
let owner_hash = poseidon2_hash([context.msg_sender().to_field()]);
```

This hash is included in cross-chain messages, allowing verification that the same owner initiated and finalized operations without revealing their identity.

#### 2. Secret/SecretHash - Claim Authentication

Users generate a secret during deposit, and the hash is included in messages:

```noir
let secret_hash = poseidon2_hash([secret]);
```

To finalize operations on L2, the user must provide the original secret, which is verified against the stored hash. This prevents front-running and ensures only the original depositor can claim funds.

### Privacy Guarantees

| Property | Guarantee |
|----------|-----------|
| Owner identity | Never revealed in L1/Target messages or events |
| Deposit amounts | Visible on L1/Target (considered acceptable for MVP) |
| Timing linkability | Possible via transaction timing analysis |
| Cross-chain tracing | Possible via intent ID correlation |

### Privacy Limitations

- **Amount privacy**: Unlike Tornado Cash, amounts are not hidden via fixed denominations (considered unnecessary complexity for MVP)
- **Timing analysis**: Deposits/withdrawals can be correlated by timing
- **Intent ID linkability**: Same intent ID appears across all layers

---

## Cross-Chain Message Flow

### Deposit Flow

```
1. User calls request_deposit(asset, amount, target_chain_id, deadline, salt)
   └─> Creates DepositIntent with hash(ownerL2)
   └─> Stores intentId → owner mapping (private)
   └─> Sends L2→L1 message with intent details

2. Relayer calls executeDeposit(intent, l2BlockNumber, leafIndex, siblingPath)
   └─> Validates message against Aztec outbox
   └─> Validates deadline bounds (5 min ≤ deadline ≤ 24 hours)
   └─> Bridges tokens via Wormhole transferTokensWithPayload

3. Target executor receives Wormhole token transfer
   └─> Verifies VAA signatures
   └─> Denormalizes amount (if >8 decimals)
   └─> Supplies to Aave pool
   └─> Records per-intent shares
   └─> Sends confirmation via Wormhole Relayer

4. L1 portal receives confirmation
   └─> Validates source chain and emitter
   └─> Sends L1→L2 finalization message

5. User calls finalize_deposit(intent_id, shares, l1_block, leaf, path)
   └─> Consumes L1→L2 message
   └─> Resolves owner from intent_owners mapping
   └─> Creates Active PositionReceiptNote
```

### Withdrawal Flow

```
1. User calls request_withdraw(nonce, amount, deadline)
   └─> Finds existing Active note by nonce
   └─> Validates full withdrawal (amount == shares)
   └─> Updates note status to PendingWithdraw
   └─> Stores deadline for refund mechanism
   └─> Sends L2→L1 withdrawal message

2. Relayer calls executeWithdraw(intent, l2BlockNumber, leafIndex, siblingPath)
   └─> Validates message against Aztec outbox
   └─> Sends payload via Wormhole Relayer (no tokens yet)

3. Target executor receives Wormhole message
   └─> Verifies VAA
   └─> Withdraws from Aave pool
   └─> Bridges tokens back via Wormhole TokenBridge
   └─> Sends confirmation

4. L1 portal receives tokens and confirmation
   └─> Deposits tokens to Aztec L2 token portal
   └─> Sends L1→L2 finalization message

5. User calls finalize_withdraw(intent_id, amount, l1_block, leaf, path)
   └─> Consumes L1→L2 message
   └─> Nullifies PendingWithdraw note
```

### Refund Flow (Expired Withdrawals)

If a withdrawal request expires without processing:

```
1. User calls claim_refund(nonce, owner, asset_id, shares, target_chain_id, aave_market_id)
   └─> Finds PendingWithdraw note matching parameters
   └─> Validates deadline has expired (current_time >= deadline)
   └─> Nullifies PendingWithdraw note
   └─> Creates new Active note with fresh nonce
```

---

## Key Implementation Decisions

### 1. Full Withdrawal Only

**Decision**: Withdrawals must be for the full position amount.

**Rationale**:
- Simplifies note lifecycle (no splitting/merging)
- Reduces complexity in share tracking
- Prevents dust accumulation

**Implementation**: `request_withdraw` validates `amount == shares` and reverts otherwise.

### 2. Per-Intent Share Tracking

**Decision**: Target executor tracks shares per intent ID, not per owner.

**Rationale**:
- Maintains privacy (no owner address on target chain)
- Enables yield tracking per position
- Supports anonymous pool model

**Implementation**:
```solidity
mapping(bytes32 => uint256) public intentShares;
mapping(bytes32 => mapping(address => uint256)) public deposits;
```

### 3. Unlimited Retry Queue

**Decision**: Failed operations are queued indefinitely, retryable by original caller only.

**Rationale**:
- Prevents permanent loss of funds on transient failures
- Original caller restriction prevents griefing
- No admin intervention needed for recovery

**Implementation**:
```solidity
struct FailedOperation {
    OperationType operationType;
    bytes32 intentId;
    bytes32 ownerHash;
    address asset;
    uint256 amount;
    uint64 failedAt;
    uint8 retryCount;
    address originalCaller;
    string errorReason;
}
```

### 4. Deadline Enforcement at L1

**Decision**: Deadline bounds validated on L1 portal, not L2 contract.

**Rationale**:
- L2 private context has no access to `block.timestamp`
- L1 validation is authoritative for cross-chain timing
- Simplifies L2 contract logic

**Implementation**:
- L2: Stores deadline without validation
- L1: Enforces `MIN_DEADLINE (5 min) ≤ deadline ≤ MAX_DEADLINE (24 hours)`

### 5. Wormhole Token Normalization Handling

**Decision**: Store original decimals in intent, denormalize on target chain.

**Rationale**:
- Wormhole normalizes all tokens to 8 decimals
- Original precision needed for accurate Aave operations
- Prevents dust/rounding issues

**Implementation**:
```solidity
// Target executor denormalization
if (originalDecimals > 8) {
    amount = wormholeAmount * 10**(originalDecimals - 8);
}
```

### 6. RAY Math for Yield Tracking

**Decision**: Use Aave's RAY (1e27) precision for yield calculations.

**Rationale**:
- Matches Aave internal precision
- Prevents rounding errors in yield accrual
- Industry standard for DeFi position tracking

**Implementation**:
```solidity
uint256 constant RAY = 1e27;
function getPositionValue(bytes32 intentId, address asset) public view returns (uint256 shares, uint256 currentValue) {
    uint256 normalizedIncome = ILendingPool(aavePool).getReserveNormalizedIncome(asset);
    currentValue = (shares * normalizedIncome) / RAY;
}
```

---

## Deviations from Specification

### 1. Deadline Bounds

| Aspect | Specification | Implementation |
|--------|--------------|----------------|
| L2 min deadline | 30 minutes | N/A (no L2 validation) |
| L2 max deadline | 7 days | N/A (no L2 validation) |
| L1 min deadline | Not specified | 5 minutes |
| L1 max deadline | Not specified | 24 hours |

**Reason**: L1 enforcement is more reliable and prevents stale intents from clogging the system.

### 2. Solidity Version

| Aspect | Specification | Implementation |
|--------|--------------|----------------|
| L1 contracts | 0.8.33 | 0.8.24 |
| Target contracts | 0.8.33 | 0.8.20 |

**Reason**: Chosen versions are stable and widely used. 0.8.33 was specified but not necessary for the features used.

### 3. Asset Support

| Aspect | Specification | Implementation |
|--------|--------------|----------------|
| Supported assets | USDC only (hardcoded) | Any ERC20 (multi-asset) |

**Reason**: Multi-asset support adds minimal complexity and increases flexibility. Asset restrictions can be added via admin allowlist if needed.

### 4. Emergency Pause Behavior

| Aspect | Specification | Implementation |
|--------|--------------|----------------|
| Pause scope | Blocks new operations only | Blocks executeDeposit/executeWithdraw |
| In-flight handling | In-flight can complete | Confirmations still processed |

**Reason**: Implemented as specified - pause blocks new user-initiated operations but allows in-flight operations to complete.

---

## Known Limitations

### 1. Custodial Model

The target executor contract holds all aTokens in custody. This creates:
- Single point of failure risk
- Requires trust in contract security
- No per-user segregation of funds

**Mitigation**: Emergency withdraw function, comprehensive testing, planned audit.

### 2. No Partial Withdrawals

Users must withdraw their entire position. This may be inconvenient for:
- Large positions needing gradual exit
- Users wanting to retain some yield exposure

**Future Work**: Post-MVP could add partial withdrawal support with note splitting.

### 3. Timing Linkability

Deposits and withdrawals can be linked through:
- Transaction timing analysis
- Intent ID correlation across chains
- Amount matching

**Future Work**: Batching, delayed execution, or denomination pools could improve privacy.

### 4. Gas Cost Variability

Cross-chain operations involve:
- L2 transaction fees (Aztec)
- L1 transaction fees (Ethereum)
- Wormhole relayer fees
- Target chain transaction fees

**Impact**: Total cost can be significant and variable based on network congestion.

### 5. Relayer Dependency

The system requires relayers to:
- Execute L1 portal functions
- Deliver Wormhole messages
- Pay gas fees (reimbursed via msg.value)

**Impact**: Operations may be delayed if relayers are unavailable.

---

## Gotchas for Future Developers

### 1. Aztec L1 Timing

**Critical**: Do not set `--block-time` on the anvil-l1 instance when running locally. The Aztec sandbox controls L1 block timing via the `/advance_chain` endpoint.

```yaml
# docker-compose.yml
anvil-l1:
  command: anvil --host 0.0.0.0
  # NO --block-time flag!
```

### 2. Wormhole Amount Normalization

All tokens with >8 decimals are normalized by Wormhole. When testing:
- USDC (6 decimals): No normalization
- WETH (18 decimals): Normalized to 8 decimals, must denormalize

```solidity
// Always check originalDecimals in payload
uint8 originalDecimals = intent.originalDecimals;
if (originalDecimals > 8) {
    actualAmount = receivedAmount * 10**(originalDecimals - 8);
}
```

### 3. Intent ID Computation

Intent IDs must be computed identically across all three layers:

```
intentId = poseidon2_hash([caller, asset, amount, originalDecimals, targetChainId, deadline, salt])
```

**Warning**: Any mismatch in field ordering or hashing will cause message verification failures.

### 4. Note Status Transitions

Position receipt notes follow a strict state machine:

```
PENDING_DEPOSIT (0) → ACTIVE (1) → PENDING_WITHDRAW (2)
                                  ↓
                            ACTIVE (1) (via refund)
```

**Never**: ACTIVE → PENDING_DEPOSIT (invalid transition)

### 5. Deadline Expiry Check

The deadline check uses inclusive comparison:

```noir
// Refund available when: current_time >= deadline
assert(current_time >= deadline, "Deadline has not expired");
```

This means refunds are available exactly at the deadline timestamp, not after.

### 6. Private Note Retrieval

When finding notes in private state, you must know the note parameters:

```noir
// Must provide exact matching parameters
let note = receipts.get_notes(NoteGetterOptions::new().select(
    nonce_field,
    Comparator.EQ,
    expected_nonce
));
```

**Warning**: Cannot query notes without knowing their field values.

### 7. Message Hash Encoding

L2→L1 and L1→L2 messages must use consistent ABI encoding:

```noir
// L2: Noir encoding
let content_hash = poseidon2_hash([
    intent_id,
    owner_hash,
    asset.to_field(),
    amount.to_field(),
    // ... etc
]);
```

```solidity
// L1: Solidity encoding (must match)
bytes32 contentHash = keccak256(abi.encode(
    intentId,
    ownerHash,
    asset,
    amount,
    // ... etc
));
```

**Note**: Aztec uses Poseidon hash for message content, not keccak256.

### 8. Wormhole Emitter Verification

Always verify the emitter address when receiving Wormhole messages:

```solidity
require(
    emitterAddress == l1PortalAddress,
    "Invalid emitter"
);
require(
    emitterChainId == ETHEREUM_WORMHOLE_CHAIN_ID,
    "Invalid source chain"
);
```

Failing to verify allows message spoofing.

---

## Testing Strategy

### Unit Tests (Comprehensive)

- **L2 (Noir)**: `aztec/src/test/*.nr`
  - Hash determinism and uniqueness
  - Collision resistance
  - Edge cases (zero values, max values)

- **L1 (Solidity)**: `eth/test/*.t.sol`
  - Deposit/withdraw execution
  - Confirmation handling
  - Admin functions

- **Target (Solidity)**: `target/test/*.t.sol`
  - VAA verification
  - Aave integration
  - Retry queue

### Integration Tests (Partial)

- **E2E**: `e2e/src/integration.test.ts`
  - Cross-layer message flow
  - Privacy property verification

**Note**: `e2e.test.ts` contains placeholder tests only (not implemented).

### Test Execution

```bash
# All unit tests
make test

# Single layer
make test-l1      # cd l1 && forge test -vv
make test-l2      # cd aztec && aztec test
make test-target  # cd target && forge test -vv

# E2E (requires devnet)
make devnet-up
make devnet-health
make e2e
```

### Test Coverage Gaps

| Area | Status | Priority |
|------|--------|----------|
| L2 unit tests | Comprehensive | - |
| L1 unit tests | Comprehensive | - |
| Target unit tests | Good | - |
| E2E deposit flow | Placeholder | HIGH |
| E2E withdrawal flow | Placeholder | HIGH |
| E2E refund flow | Placeholder | MEDIUM |
| Multi-user scenarios | Partial | MEDIUM |
| Failure scenarios | Partial | MEDIUM |

---

## References

- [spec.md](./spec.md) - Original architecture specification
- [IMPLEMENTATION_PLAN_spec.md](./IMPLEMENTATION_PLAN_spec.md) - Step-by-step implementation plan
- [RESEARCH.md](./RESEARCH.md) - Technical research findings
- [Aztec Uniswap Tutorial](https://docs.aztec.network/developers/docs/tutorials/js_tutorials/uniswap) - Pattern reference
- [Wormhole Documentation](https://docs.wormhole.com/) - Cross-chain bridging
- [Aave V3 Documentation](https://docs.aave.com/developers/core-contracts/pool) - Lending protocol
