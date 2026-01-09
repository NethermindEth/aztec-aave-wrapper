# Aztec Aave Wrapper Research

**Status**: Research and planning phase complete. Implementation in progress.

**Last Updated**: 2026-01-09

---

## Project State

This is an **active greenfield project** implementing privacy-preserving Aave lending from Aztec L2 via Wormhole bridge.

**Current repository status:**
- Monorepo structure established (bun workspaces)
- L2 (Noir), L1 (Foundry), Target (Foundry), E2E packages created
- Docker Compose devnet configured
- L2 contract implementation complete (Phase 2)
- L1 portal implementation complete (Phase 3)
- L2 integration tests complete
- E2E testing in progress (Phase 5)

---

## Architecture Overview

The project follows the **Aztec Uniswap L1-from-L2 tutorial pattern** with three layers:

| Layer | Component | Technology | Purpose |
|-------|-----------|------------|---------|
| **L2 (Noir)** | `AaveWrapper` | Noir/Aztec | Creates private intents, manages encrypted position receipts |
| **L1 (Solidity)** | `AztecAavePortalL1` | Solidity/Ethereum | Consumes Aztec messages, bridges via Wormhole |
| **Target (Solidity)** | `AaveExecutorTarget` | Solidity/Arbitrum | Executes Aave operations on destination chain |

### Current Implementation vs. Original Spec

**Two Implementation Approaches Documented**:

1. **Original Spec Approach** (spec.md):
   - Three-layer architecture with Wormhole bridging to target chain
   - "Anyone can execute" relayer model
   - Simple privacy: L1/target execution doesn't require user identity

2. **Alternative MVP Approach** (PLAN.md):
   - Two-layer L2+L1 only (Wormhole deferred to Phase 4)
   - Enhanced privacy via fixed denominations + secret-based claims
   - Pre-funded pool model on L1
   - Direct Aave integration on Ethereum L1

**Decision Point**: PLAN_UPDATED.md identifies architectural mismatch. The project should clarify which approach to implement before proceeding with Phase 5 E2E testing.

---

## Privacy Model Analysis

### Original Spec Privacy Model
- **Mechanism**: "Anyone can execute" relayer pattern
- **Privacy Guarantee**: L2 user address not required in L1/target execution
- **Anonymity Set**: All users of the system (linkable by amount/timing)

### Alternative MVP Privacy Model (from PLAN.md)
- **Mechanism**: Fixed denominations (1000, 5000, 10000 USDC) + secret/secretHash
- **Privacy Guarantee**: L1 sees only (intentId, secretHash, denomination) - NO user identity or exact amounts
- **Anonymity Set**: All users within same denomination tier (larger anonymity set)
- **Inspiration**: Tornado Cash privacy pattern

**Trade-offs**:
| Aspect | Original Spec | Alternative MVP |
|--------|---------------|-----------------|
| **Privacy** | Basic unlinkability | Strong unlinkability via denomination pools |
| **Complexity** | Lower (direct bridging) | Higher (pre-funded pool, secret management) |
| **Flexibility** | Any amount | Fixed denominations only |
| **UX** | Simple | Requires secret backup/recovery |
| **Capital Efficiency** | Direct user capital | Requires L1 pool pre-funding |

---

## Technical Research Findings

### Aztec L2 Integration

**Contract Structure** (from implemented Phase 2):
```noir
struct PositionReceiptNote {
    owner: AztecAddress,
    nonce: Field,
    asset_id: Field,
    denomination: u8,        // Alternative: amount: u128 for spec approach
    secret: Field,           // Alternative: Remove for spec approach
    target_chain_id: u32,
    status: u8,              // 0=PendingDeposit, 1=Active, 2=PendingWithdraw
}
```

**Key Findings**:
- Private notes provide encrypted storage - only owner can decrypt
- L2→L1 messages support arbitrary payload encoding
- L1→L2 message consumption requires hash verification
- State machine pattern (PendingDeposit → Active → PendingWithdraw) works within private state

**Dependencies**:
- `aztec-nr` from aztec-packages v3.0.0-devnet.20251212
- Noir compiler version must match aztec-packages
- PXE required for local development

### Wormhole Integration

**Research Status**: ⚠️ **INCOMPLETE** - Deferred in alternative MVP approach

**Mode B Recommended** (`transferTokensWithPayload`):
- Atomic token + message delivery
- Token normalization to 8 decimals required
- Target receives both tokens and execution instructions

**Outstanding Questions**:
1. Wormhole testnet vs mock contracts for local testing?
2. Relayer fee estimation and payment mechanism?
3. VAA signature verification gas costs?

### Aave V3 Integration

**Implementation Complete** (L1 direct integration in alternative approach):
- `IPool.supply(asset, amount, onBehalfOf, referralCode)` - Deposits into Aave
- `IPool.withdraw(asset, amount, to)` - Withdraws from Aave
- aTokens minted 1:1 with underlying (ignoring yield for MVP)

**Custody Model**:
- L1 contract holds all aTokens in custodial model
- User entitlements tracked via `depositedShares[secretHash]` mapping (alternative) OR `intentPrincipals[intentId]` (spec)
- No yield distribution in MVP (simplification)

**Outstanding Questions**:
1. Handle Aave liquidity shortfalls gracefully?
2. aToken/debtToken accounting for variable rate positions?
3. Supply cap enforcement on Aave pools?

### Local Development Environment

**Docker Compose Setup** (Phase 1 complete):
```yaml
services:
  anvil-l1:       # Ethereum L1 (port 8545) - NO --block-time flag
  anvil-target:   # Target chain (port 8546)
  aztec-sandbox:  # Aztec PXE (port 8080) - controls L1 timing
```

**Critical Configuration**: L1 anvil must NOT have `--block-time` set - Aztec sandbox controls L1 timing via `/advance_chain` endpoint.

**Validation**:
- `make devnet-up && make devnet-health` - All services healthy
- `make build` - All contracts compile
- `make test` - L1, L2, Target unit tests pass

---

## Dependency Versions (Verified)

| Dependency | Version | Status |
|------------|---------|--------|
| **Bun** | 1.1.0+ | ✅ Verified working |
| **Foundry** | Latest via foundryup | ✅ Verified working |
| **Nargo** | Must match aztec-packages | ⚠️ Version pinning needed |
| **aztec-nr** | aztec-packages-v3.0.0-devnet.20251212 | ✅ Specified in aztec.toml |
| **OpenZeppelin** | 5.x | ✅ Used for Ownable, ReentrancyGuard |
| **Aave V3 Core** | 1.19.x | ✅ Interface only |
| **aztec.js** | ^0.65.0 | ✅ E2E test dependency |

**Tooling Check**:
```bash
make check-tooling  # Validates all dependencies installed
```

---

## Message Encoding Research

### L2→L1 Message Format

**Alternative MVP Approach** (secret-based):
```noir
// DepositIntent (L2→L1)
abi.encode(
  bytes32 intentId,
  bytes32 secretHash,      // hash(secret) - NO user identity
  uint8 denomination,      // 0=1000, 1=5000, 2=10000 USDC
  uint64 deadline
)
```

**Original Spec Approach**:
```noir
// DepositIntent (L2→L1)
abi.encode(
  bytes32 intentId,
  address asset,
  uint128 amount,          // Exact amount, not denomination
  uint32 targetChainId,
  uint64 deadline
)
```

**Key Difference**: Spec approach includes exact amounts and target chain; alternative approach hides amounts via denominations.

### Wormhole Payload Format

**Research Status**: ⚠️ **NOT IMPLEMENTED** - Deferred to Phase 4 in alternative approach

**Planned Format** (from spec):
```solidity
// L1 → Target (via transferTokensWithPayload)
abi.encode(
  bytes32 intentId,
  address asset,
  uint256 amount,          // Normalized to 8 decimals by Wormhole
  uint8 action,            // 0=DEPOSIT, 1=WITHDRAW
  uint64 deadline
)
```

---

## Security Research

### Replay Protection Mechanisms

**Three-Layer Defense** (implemented in Phase 2-3):

1. **Intent ID Tracking**: `mapping(bytes32 => bool) consumedIntents` on L1
2. **Emitter Verification**: L1 only accepts messages from trusted L2 contract address
3. **Secret Verification** (alternative approach): `hash(secret) == secretHash` check on withdrawal

**Additional Protections**:
- Deadline enforcement prevents stale intent execution
- Denomination matching prevents tier confusion (alternative approach)
- VAA hash tracking (spec approach, not yet implemented)

### Privacy Guarantees

**Alternative MVP Guarantees** (from PLAN.md):
- ✅ User identity NEVER in L2→L1 messages
- ✅ Exact amounts hidden (only denomination tier visible)
- ✅ Withdrawal requires secret knowledge
- ✅ Public events emit only (intentId, status) - no user data

**Original Spec Guarantees**:
- ✅ L1/target execution doesn't require user identity
- ⚠️ Amounts and assets visible in messages (less privacy)
- ⚠️ No denomination-based anonymity sets

---

## Open Questions & Decision Points

### 🔴 Critical Architectural Decision

**Which approach to implement?**

| Decision | Impact |
|----------|--------|
| **A: Original Spec (3-layer with Wormhole)** | Complete spec.md requirements, simpler privacy model, requires Wormhole implementation |
| **B: Alternative MVP (2-layer L2+L1)** | Enhanced privacy, simpler testing, defers Wormhole complexity |
| **C: Hybrid** | Start with B for MVP, design for A migration path |

**Recommendation**: Clarify with stakeholders before Phase 5 E2E completion.

### Technical Open Questions

1. **Wormhole Testing Strategy**:
   - Use Wormhole testnet (requires cross-chain coordination)?
   - Mock Wormhole contracts (faster iteration, less realistic)?
   - Local Wormhole Guardian Network (complex setup)?

2. **Asset Selection**:
   - USDC (requires token portal on Aztec)?
   - DAI (better Aave liquidity on testnets)?
   - Custom test token (full control, not realistic)?

3. **Yield Handling**:
   - Return actual aToken balance (includes yield, complicates accounting)?
   - Cap at principal (simpler MVP, wastes yield)?
   - Separate yield claim mechanism (most complex)?

4. **Target Chain**:
   - Arbitrum Sepolia (real testnet, slower iteration)?
   - Local anvil fork (faster, needs Aave deployment)?
   - Arbitrum mainnet fork (realistic, complex setup)?

5. **Secret Management** (alternative approach only):
   - Client-side secret generation and backup?
   - Derive secret from user wallet signature?
   - Recovery mechanism if secret lost?

6. **Pool Funding** (alternative approach only):
   - Admin pre-funds pool manually?
   - Automatic pool rebalancing mechanism?
   - Minimum pool balance alerts?

---

## Test Coverage Analysis

### Phase 2 - L2 Contract (Complete ✅)

**Test Files**:
- `aztec_contracts/src/test/deposit_tests.nr` - Deposit flow
- `aztec_contracts/src/test/withdraw_tests.nr` - Withdraw flow
- `aztec_contracts/src/test/edge_cases.nr` - Error conditions

**Coverage**: All L2 functions tested in isolation with mocked L1→L2 messages.

### Phase 3 - L1 Portal (Complete ✅)

**Test Files**:
- `l1/test/Portal.executeDeposit.t.sol` - Deposit execution
- `l1/test/Portal.executeWithdraw.t.sol` - Withdraw with secret verification
- `l1/test/Portal.poolFunding.t.sol` - Pool management
- `l1/test/Portal.privacy.t.sol` - Privacy verification
- `l1/test/Portal.edgeCases.t.sol` - Error conditions

**Coverage**: >90% line coverage on L1 portal contract.

### Phase 5 - E2E Integration (In Progress ⚠️)

**Status**: Infrastructure ready, tests being written

**Planned Tests**:
- Full deposit cycle (L2 → L1 → [Target] → L1 → L2)
- Full withdrawal cycle
- Multi-user anonymity set verification
- Privacy guarantee validation
- Edge case handling (deadline, replay, invalid secret)

**Blockers**:
- Architectural decision (spec vs alternative approach) needed
- Wormhole integration strategy undefined

---

## Performance & Gas Research

**Status**: ⚠️ **NOT MEASURED** - No gas benchmarks yet

**Key Metrics to Measure**:
- L2 `request_deposit` gas cost
- L2 `finalize_deposit` gas cost (note creation)
- L1 `executeDeposit` gas cost (Aave supply + Aztec message)
- L1 `executeWithdraw` gas cost (secret verification + Aave withdraw)
- Target executor gas costs (Wormhole VAA verification + Aave)
- E2E total gas cost

**Expected Costs** (rough estimates):
- L2 operations: ~1-2M gas (Aztec native)
- L1 portal operations: ~200-500k gas (Solidity)
- Wormhole bridging: ~100-300k gas (VAA verification)
- Aave supply/withdraw: ~200-400k gas

---

## Deployment Strategy Research

### Local Development (Phase 1 - Complete ✅)

```bash
make devnet-up      # Start Docker containers
make deploy-local   # Deploy all contracts
make e2e            # Run E2E tests
```

### Testnet Deployment (Phase 6 - Planned)

**Target Networks**:
- **L2**: Aztec devnet (public testnet)
- **L1**: Ethereum Sepolia
- **Target**: Arbitrum Sepolia (if using 3-layer) OR same as L1 (if 2-layer)

**Deployment Order**:
1. Deploy L2 contract via `aztec deploy`
2. Deploy L1 portal (needs L2 contract address)
3. Deploy target executor (needs L1 portal address + Wormhole config)
4. Configure cross-contract addresses
5. Fund L1 pool (alternative approach) or token portal (spec approach)

**Outstanding**:
- Testnet faucet procedures
- Contract verification on block explorers
- Monitoring and alerting setup

---

## References

### Official Documentation
- [Aztec Uniswap Tutorial](https://docs.aztec.network/developers/docs/tutorials/js_tutorials/uniswap) - Primary pattern reference
- [Aztec PXE Documentation](https://docs.aztec.network/developers/docs/concepts/pxe) - Private execution environment
- [Aztec Migration Notes](https://docs.aztec.network/developers/docs/resources/migration_notes) - Portal API versioning
- [Wormhole Docs - Token Transfer](https://docs.wormhole.com/wormhole/explore-wormhole/token-bridge) - Cross-chain token bridging
- [Aave V3 Documentation](https://docs.aave.com/developers/core-contracts/pool) - Lending pool interface

### Code References
- [Nethermind Aztec-Wormhole Demo](https://github.com/NethermindEth/aztec-wormhole-app-demo) - Cross-chain integration reference
- [Aztec Token Bridge Tutorial](https://github.com/AztecProtocol/aztec-packages/tree/master/yarn-project/end-to-end/src/guides) - Token portal patterns
- [Tornado Cash Nova](https://github.com/tornadocash/tornado-nova) - Privacy pattern inspiration (alternative approach)

### Research Papers & Discussions
- Aztec Protocol Privacy Model Whitepaper
- Wormhole Security Model Documentation
- Aave V3 Risk Parameters

---

## Next Steps

### Immediate (Before Phase 5 E2E Completion)

1. **🔴 CRITICAL**: Resolve architectural approach (spec vs alternative vs hybrid)
2. Document decision rationale in updated PLAN.md
3. If choosing alternative approach: Update spec.md to reflect actual MVP scope
4. If choosing spec approach: Rewrite implemented L2/L1 contracts to match spec

### Short Term (Phase 5)

1. Complete E2E test implementation based on chosen architecture
2. Implement Wormhole integration (if spec approach) or document deferral (if alternative)
3. Measure and document gas costs
4. Complete privacy guarantee verification tests

### Medium Term (Phase 6)

1. Write comprehensive developer documentation
2. Create testnet deployment configuration
3. Deploy to testnets and run E2E validation
4. Create operational runbook

### Long Term (Post-MVP)

1. If alternative approach chosen: Implement Wormhole cross-chain (deferred Phase 4)
2. Add yield distribution mechanism
3. Implement recovery mechanisms for edge cases
4. Security audit preparation
