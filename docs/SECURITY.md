# Security Audit Checklist

This document provides a comprehensive security checklist for the Aztec Aave Wrapper project. It is intended to guide internal security reviews and prepare for external audits.

**Last Updated**: 2026-01-13

---

## Table of Contents

1. [Security Overview](#security-overview)
2. [Custodial Risk](#custodial-risk)
3. [Replay Protection](#replay-protection)
4. [Privacy Model](#privacy-model)
5. [Retry Queue Security](#retry-queue-security)
6. [Emergency Pause Behavior](#emergency-pause-behavior)
7. [Deadline Enforcement](#deadline-enforcement)
8. [Cross-Chain Security](#cross-chain-security)
9. [Smart Contract Vulnerabilities](#smart-contract-vulnerabilities)
10. [External Dependencies](#external-dependencies)
11. [Operational Security](#operational-security)
12. [Audit Checklist](#audit-checklist)

---

## Security Overview

The Aztec Aave Wrapper is a cross-chain protocol spanning three layers:

| Layer | Contract | Primary Risks |
|-------|----------|---------------|
| L2 (Aztec) | `AaveWrapper` (Noir) | Note manipulation, intent spoofing, privacy leaks |
| L1 (Ethereum) | `AztecAavePortalL1` | Message validation, token handling, reentrancy |
| Target Chain | `AaveExecutorTarget` | VAA verification, Aave integration, fund custody |

### Trust Assumptions

1. **Aztec Messaging**: L2-L1 message proofs are valid if accepted by the Aztec outbox
2. **Wormhole**: VAA signatures from 13+ guardians are considered valid
3. **Aave V3**: The Aave pool contract behaves correctly
4. **Token Contracts**: ERC20 tokens follow the standard (no fee-on-transfer in MVP)

---

## Custodial Risk

### Description

The target executor contract (`AaveExecutorTarget`) holds all aTokens in custody on behalf of users. This creates a single point of failure.

### Risk Level: HIGH

### Current Mitigations

1. **Per-intent share tracking**: Each intent's shares are tracked separately
   - Location: `target/contracts/AaveExecutorTarget.sol:66`
   - Mapping: `intentShares[intentId] => shares`

2. **Emergency withdraw function**: Admin can recover stuck tokens
   - Location: `eth/contracts/AztecAavePortalL1.sol:646`
   - Protected by: `onlyOwner` modifier

3. **No admin keys on target**: Target executor has no owner/admin functions
   - Reduces centralization risk on the target chain

### Audit Items

- [ ] Verify `intentShares` accounting cannot be manipulated
- [ ] Verify `deposits` mapping updates follow checks-effects-interactions
- [ ] Verify emergency withdraw cannot be used to steal user funds
- [ ] Review scenarios where admin could extract more than stuck tokens
- [ ] Assess impact of target executor contract upgrade/migration

### Recommendations for Production

- Implement time-locked admin actions (48-hour delay)
- Use multi-sig for admin operations
- Consider per-user position segregation (post-MVP)
- Add on-chain accounting reconciliation checks

---

## Replay Protection

### Description

Cross-chain operations must not be executable more than once. Multiple replay vectors exist across the three-layer architecture.

### Risk Level: HIGH

### Current Mitigations

#### L2 (Aztec)
- **Intent consumption tracking**: `consumed_intents` mapping prevents reuse
  - Location: `aztec/src/main.nr:256`
- **Note nullifiers**: Aztec framework prevents double-spending of notes

#### L1 Portal
- **Intent ID tracking**: `consumedIntents` mapping checked before execution
  - Location: `eth/contracts/AztecAavePortalL1.sol:89`
- **Wormhole delivery tracking**: `processedDeliveries` mapping for confirmations
  - Location: `eth/contracts/AztecAavePortalL1.sol:93`
- **VAA hash tracking**: `processedVAAs` mapping for token transfers
  - Location: `eth/contracts/AztecAavePortalL1.sol:95`

#### Target Executor
- **VAA consumption tracking**: `consumedVAAs` mapping checked before execution
  - Location: `target/contracts/AaveExecutorTarget.sol:55`

### Audit Items

- [ ] Verify all replay protection mappings are updated BEFORE external calls
- [ ] Verify intent ID computation is deterministic across all layers
- [ ] Test cross-chain replay: same intent on different target chains
- [ ] Test timing replay: expired intent re-submitted before expiry
- [ ] Verify Aztec outbox message consumption is atomic
- [ ] Verify L1-L2 message consumption includes nullifier emission

### Attack Vectors to Test

1. **Double-spend via race condition**: Submit same VAA to two nodes simultaneously
2. **Cross-chain replay**: Use L1 message on wrong target chain
3. **Intent ID collision**: Craft inputs that produce same intent ID for different operations
4. **Message reordering**: Process confirmation before deposit completes

---

## Privacy Model

### Description

The protocol uses `hash(ownerL2)` to protect user identity in cross-chain messages. This provides pseudonymity but not full privacy.

### Risk Level: MEDIUM

### Current Implementation

1. **Owner hash computation**: Poseidon2 hash of L2 address
   - Location: `aztec/src/main.nr:363`
   - Formula: `owner_hash = poseidon2_hash([caller.to_field()])`

2. **Secret/SecretHash mechanism**: Claim authentication
   - User provides `secret_hash` during deposit request
   - Must provide matching `secret` during finalization

3. **Public events emit only intent_id**: No user-identifying data
   - Location: `aztec/src/main.nr:291-294`

### Privacy Limitations

| Property | Privacy Level | Notes |
|----------|---------------|-------|
| Owner identity | Pseudonymous | Hash cannot be reversed, but can be correlated |
| Deposit amounts | Public | Visible on L1 and target chain |
| Timing | Public | Can link deposits/withdrawals via timing analysis |
| Intent IDs | Public | Same ID appears across all layers |

### Audit Items

- [ ] Verify `owner_hash` is computed consistently across all message types
- [ ] Verify no L2 address leaks in public state or events
- [ ] Verify intent_owners mapping doesn't leak information to non-participants
- [ ] Test privacy against timing correlation attacks
- [ ] Verify secret_hash binding prevents front-running
- [ ] Review note encryption and delivery mechanisms

### Known Privacy Weaknesses

1. **Amount correlation**: Matching amounts across layers can link transactions
2. **Timing analysis**: Sequential deposit/withdraw can be linked
3. **Intent ID linkability**: Same intent ID visible across all chains
4. **Gas payer correlation**: Relayer address may be trackable

---

## Retry Queue Security

### Description

Failed Aave operations are queued for retry. The queue is unlimited and only the original caller can retry.

### Risk Level: MEDIUM

### Current Implementation

- Location: `target/contracts/AaveExecutorTarget.sol:62-73`
- Structure: `FailedOperation` struct with intent details
- Access control: `originalCaller` restriction on retry

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

### Audit Items

- [ ] Verify only original caller can retry operations
- [ ] Verify tokens remain in contract during queue period
- [ ] Verify queue index cannot overflow
- [ ] Verify removal from queue clears all fields
- [ ] Test queue manipulation: can attacker block legitimate retries?
- [ ] Test storage exhaustion: unlimited queue growth
- [ ] Verify approval reset after failed operation

### Potential Attack Vectors

1. **Griefing via queue flooding**: Attacker fills queue with failed operations
2. **Original caller restriction bypass**: If caller address can be spoofed
3. **Token approval persistence**: Leftover approvals after failed retry
4. **Queue index reuse**: If deleted indices are recycled

### Mitigations

- Queue indices are never reused (`nextQueueIndex` monotonically increases)
- Approvals are reset to 0 after failed operations
- Original caller verified via `msg.sender`

---

## Emergency Pause Behavior

### Description

The L1 portal can be paused by the admin to stop new operations while allowing in-flight operations to complete.

### Risk Level: MEDIUM

### Current Implementation

- Location: `eth/contracts/AztecAavePortalL1.sol:617-627`
- Scope: Pauses `executeDeposit` and `executeWithdraw` only
- NOT paused: `receiveWormholeMessages`, `completeWithdrawalTransfer`

### Pause Scope

| Function | Paused? | Rationale |
|----------|---------|-----------|
| `executeDeposit` | Yes | Blocks new user operations |
| `executeWithdraw` | Yes | Blocks new user operations |
| `receiveWormholeMessages` | No | Allows confirmations to complete |
| `completeWithdrawalTransfer` | No | Allows token bridging to complete |
| `emergencyWithdraw` | No | Admin recovery always available |

### Audit Items

- [ ] Verify pause affects only intended functions
- [ ] Verify unpause can restore normal operation
- [ ] Verify in-flight operations complete correctly during pause
- [ ] Test pause during mid-flight operation
- [ ] Verify admin cannot pause to trap user funds
- [ ] Review pause/unpause event emission

### Attack Vectors

1. **Admin griefing**: Pause to prevent withdrawals indefinitely
2. **Pause timing attack**: Pause during user's operation window
3. **Selective pause**: If granular pause control exists

### Recommendations

- Add time-limited pause (auto-unpause after 7 days)
- Emit events for pause/unpause actions
- Consider pause guardian role separate from owner

---

## Deadline Enforcement

### Description

Deadlines prevent stale intents from being executed. Enforcement happens on L1 since L2 private context cannot access timestamps.

### Risk Level: MEDIUM

### Current Implementation

- Location: `eth/contracts/AztecAavePortalL1.sol:172-183`
- Bounds: `MIN_DEADLINE = 5 minutes`, `MAX_DEADLINE = 24 hours`
- Validation: `deadline - block.timestamp` must be within bounds

```solidity
function _validateDeadline(uint256 deadline) public view {
    uint256 timeUntilDeadline = deadline > block.timestamp ? deadline - block.timestamp : 0;
    if (timeUntilDeadline < MIN_DEADLINE) revert InvalidDeadline(deadline);
    if (timeUntilDeadline > MAX_DEADLINE) revert InvalidDeadline(deadline);
}
```

### Audit Items

- [ ] Verify deadline check occurs before state changes
- [ ] Verify deadline cannot be manipulated by relayer
- [ ] Test boundary conditions: exactly at MIN_DEADLINE, MAX_DEADLINE
- [ ] Test block.timestamp manipulation resistance
- [ ] Verify refund mechanism triggers correctly after expiry
- [ ] Test deadline expiry during Wormhole transit

### Attack Vectors

1. **Deadline manipulation**: Relayer delays execution until deadline passes
2. **Timestamp manipulation**: Miner manipulates block.timestamp
3. **Refund racing**: Claim refund while withdrawal in progress

### Refund Mechanism

When a withdrawal deadline expires:
1. User calls `claim_refund` on L2
2. Public function validates `current_time >= deadline`
3. New Active note created with fresh nonce
4. Position remains usable for future withdrawal attempts

Location: `aztec/src/main.nr:866-962`

---

## Cross-Chain Security

### Description

The protocol relies on Wormhole for cross-chain message passing and token bridging. Multiple verification points exist.

### Risk Level: HIGH

### Wormhole Verification Points

#### L1 Portal (Receiving confirmations)
```solidity
// Location: eth/contracts/AztecAavePortalL1.sol:362-411
function receiveWormholeMessages(...) {
    // 1. Verify caller is registered relayer
    if (msg.sender != wormholeRelayer) revert UnauthorizedRelayer(msg.sender);

    // 2. Verify source chain
    if (sourceChain != targetChainId) revert InvalidSourceChain(sourceChain);

    // 3. Verify source address (emitter)
    if (sourceAddress != targetExecutor) revert InvalidSourceAddress(sourceAddress);

    // 4. Replay protection
    if (processedDeliveries[deliveryHash]) revert DeliveryAlreadyProcessed(deliveryHash);
}
```

#### Target Executor (Receiving intents)
```solidity
// Location: target/contracts/AaveExecutorTarget.sol:159-207
function consumeAndExecuteDeposit(bytes calldata encodedVAA) {
    // 1. Verify VAA via Wormhole core
    (IWormhole.VM memory vm, bool valid, string memory reason) =
        wormhole.parseAndVerifyVM(encodedVAA);

    // 2. Verify emitter chain
    if (vm.emitterChainId != sourceChainId) revert InvalidEmitterChain(...);

    // 3. Verify emitter address
    if (vm.emitterAddress != l1PortalAddress) revert InvalidEmitterAddress(...);
}
```

### Audit Items

- [ ] Verify all emitter address checks are present and correct
- [ ] Verify chain ID validation on both directions
- [ ] Test with spoofed VAAs from wrong emitter
- [ ] Test with valid VAAs from wrong chain
- [ ] Verify Wormhole guardian threshold (13/19)
- [ ] Review VAA expiration handling
- [ ] Test payload encoding/decoding consistency

### Token Bridge Considerations

- Wormhole normalizes tokens to 8 decimals
- Original decimals stored in payload for denormalization
- Location: `target/contracts/AaveExecutorTarget.sol:290-310`

---

## Smart Contract Vulnerabilities

### OWASP-style Checklist

#### Reentrancy

| Contract | Status | Notes |
|----------|--------|-------|
| AztecAavePortalL1 | Mitigated | State updates before external calls |
| AaveExecutorTarget | Mitigated | `consumedVAAs` set before supply |

- [ ] Verify all external calls follow checks-effects-interactions
- [ ] Review SafeERC20 usage for token transfers
- [ ] Test reentrancy via malicious token contracts

#### Integer Overflow/Underflow

| Contract | Protection | Notes |
|----------|------------|-------|
| All Solidity | Solidity 0.8.x | Built-in overflow checks |
| Noir | Field arithmetic | Overflow wraps in field |

- [ ] Review uint128 to uint256 conversions
- [ ] Review Field to numeric type conversions in Noir
- [ ] Test denormalization overflow scenario

#### Access Control

| Function | Protection | Notes |
|----------|------------|-------|
| `pause/unpause` | `onlyOwner` | L1 portal admin only |
| `emergencyWithdraw` | `onlyOwner` | L1 portal admin only |
| `retryFailedOperation` | `originalCaller` | Target executor |

- [ ] Verify all admin functions are protected
- [ ] Review Ownable2Step transfer process
- [ ] Test ownership transfer edge cases

#### Front-running

| Operation | Protection | Notes |
|-----------|------------|-------|
| Deposit | Intent ID binding | Caller included in hash |
| Withdrawal | Note ownership | Only owner can withdraw |
| Finalization | Secret mechanism | Must know pre-image |

- [ ] Test front-running deposit execution
- [ ] Test front-running withdrawal finalization
- [ ] Verify secret_hash provides sufficient protection

---

## External Dependencies

### Dependency Risk Assessment

| Dependency | Version | Risk | Notes |
|------------|---------|------|-------|
| OpenZeppelin | Latest | Low | Well-audited |
| Wormhole | Mainnet | Medium | Bridge risk |
| Aave V3 | Mainnet | Low | Battle-tested |
| aztec-nr | v3.0.0-devnet | High | Pre-production |

### Audit Items

- [ ] Review OpenZeppelin contract versions for known issues
- [ ] Verify Wormhole contract addresses match official deployment
- [ ] Verify Aave pool addresses match official deployment
- [ ] Review aztec-nr security advisories
- [ ] Test behavior with Wormhole guardian set changes

---

## Operational Security

### Deployment Checklist

- [ ] Verify constructor parameters match intended values
- [ ] Verify portal address is immutable after initialization
- [ ] Verify admin address is set correctly
- [ ] Test deployment on testnet before mainnet
- [ ] Verify all addresses are checksummed

### Monitoring Recommendations

1. **Critical events to monitor**:
   - `DepositInitiated` / `DepositConfirmed`
   - `WithdrawInitiated` / `WithdrawConfirmed`
   - `OperationQueued` / `OperationRetried`
   - `EmergencyWithdraw`
   - `Paused` / `Unpaused`

2. **Anomaly detection**:
   - Large deposits/withdrawals
   - High retry queue growth
   - Unusual relayer activity
   - Failed VAA verifications

### Incident Response

1. **Pause protocol**: Admin calls `pause()` on L1 portal
2. **Assess damage**: Review transaction logs and balances
3. **Coordinate fix**: Prepare and test patch
4. **Resume operations**: Call `unpause()` after verification

---

## Audit Checklist

### Pre-Audit Preparation

- [ ] All contracts compile without warnings
- [ ] Unit test coverage > 85%
- [ ] E2E tests pass on local devnet
- [ ] Documentation is complete and accurate
- [ ] Known issues are documented

### Critical Items (Must Fix)

- [ ] Replay protection on all entry points
- [ ] VAA verification on target executor
- [ ] Emitter address validation
- [ ] Token amount handling (denormalization)
- [ ] Deadline enforcement

### High Priority Items

- [ ] Emergency withdraw safety
- [ ] Retry queue correctness
- [ ] Note lifecycle transitions
- [ ] Cross-chain message encoding consistency

### Medium Priority Items

- [ ] Event emission completeness
- [ ] Error message clarity
- [ ] Gas optimization
- [ ] Storage layout efficiency

### Low Priority Items

- [ ] Code style consistency
- [ ] Documentation typos
- [ ] Test coverage gaps (non-critical paths)

---

## References

- [CLAUDE.md](../CLAUDE.md) - Project overview and guidelines
- [IMPLEMENTATION_NOTES.md](./IMPLEMENTATION_NOTES.md) - Architecture decisions
- [spec.md](./spec.md) - Original specification
- [Aztec Security Model](https://docs.aztec.network/protocol-specs/cryptography/proving-system)
- [Wormhole Security](https://docs.wormhole.com/wormhole/security)
- [Aave V3 Security](https://docs.aave.com/developers/guides/security)
