# MVP Research Document: Aztec L2 → Ethereum L1 Aave Integration

## Executive Summary

This document outlines the simplification of the Aztec Aave Wrapper from a three-chain architecture (Aztec L2 → Ethereum L1 → Target Chain) to a two-chain MVP (Aztec L2 → Ethereum L1 Aave).

**Goal**: User privately adds liquidity to Aave pool on Ethereum L1 directly from Aztec L2.

**Current Status**: The docker-compose.yml has already been updated to remove the target chain service. The code comments indicate MVP simplification is in progress, but L1/L2/Target contracts still contain the full three-chain implementation.

---

## Part 1: Wormhole Integration Findings

### 1.1 Current Architecture vs Official Wormhole

| Aspect | Our Implementation | Official Wormhole Aztec |
|--------|-------------------|------------------------|
| **Location** | `eth/contracts/` | `/home/ametel/source/wormhole/aztec/` |
| **Messaging** | L2 → L1 Portal → Wormhole → Target | L2 → Wormhole Guardians → Target (direct) |
| **L2 Contract** | Uses `context.message_portal()` | Uses `context.emit_public_log()` |
| **Chain ID** | Custom (via portal) | Aztec = Chain ID 56 |
| **VAA Verification** | On L1 portal | On L2 via Noir ECDSA |

### 1.2 Wormhole Interface Compatibility

**IWormholeTokenBridge** - Compatible (subset of official)
- `transferTokensWithPayload` ✅
- `completeTransferWithPayload` ✅
- `normalizeAmount`/`denormalizeAmount` ✅ (our addition)
- `isTransferCompleted` ✅

**IWormholeRelayer** - Compatible (subset of official)
- `sendPayloadToEvm` ✅
- `quoteEVMDeliveryPrice` ✅
- `deliver` ✅
- `deliveryAttempted` ✅

**Reference**: Official interfaces at:
- `/home/ametel/source/wormhole/ethereum/contracts/bridge/interfaces/ITokenBridge.sol`
- `/home/ametel/source/wormhole/relayer/ethereum/contracts/interfaces/relayer/IWormholeRelayer.sol`

### 1.3 Official Wormhole Aztec Contract

**Location**: `/home/ametel/source/wormhole/aztec/contracts/src/main.nr`

**Capabilities**:
1. VAA verification on Aztec L2 (ECDSA secp256k1 in Noir)
2. Message publishing (public + private)
3. Guardian management for multi-sig

**Deployed on Aztec Testnet**: `0x2b13cff4daef709134419f1506ccae28956e02102a5ef5f2d0077e4991a9f493`

### 1.4 L2→L2 vs L2→L1→Target

**Wormhole supports direct L2→L2** (chain-to-chain without Ethereum L1 hop):
```
Aztec L2 (emit_public_log) → Wormhole Guardians observe → Sign VAA → Target Chain
```

**Our current implementation** uses L2→L1→Target:
```
Aztec L2 (message_portal) → L1 Outbox → L1 Portal → L1 Wormhole → Target
```

**Compatibility**: Our current contracts are **NOT compatible** with the official Wormhole Aztec integration. They use different messaging mechanisms.

---

## Part 2: Current Architecture Analysis

### 2.1 Contract Inventory

| Contract | Location | Chain | Purpose |
|----------|----------|-------|---------|
| `AaveWrapper` | `aztec/src/main.nr` | Aztec L2 | Private intents, position receipts |
| `AztecAavePortalL1` | `eth/contracts/AztecAavePortalL1.sol` | Ethereum L1 | Consumes L2 messages, bridges via Wormhole |
| `AaveExecutorTarget` | `target/contracts/AaveExecutorTarget.sol` | Target (e.g., Arbitrum) | Executes Aave operations |

### 2.2 Current Flow (Deposit)

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Aztec L2      │     │   Ethereum L1   │     │  Target Chain   │     │      Aave       │
│   AaveWrapper   │────▶│   Portal L1     │────▶│ AaveExecutorTgt │────▶│   LendingPool   │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
    request_deposit()    executeDeposit()      consumeAndExecuteDeposit()  supply()
         │                     │                      │                      │
         ▼                     ▼                      ▼                      ▼
    L2→L1 message        Wormhole bridge       VAA verification        aToken mint
```

### 2.3 Wormhole Dependencies in Current Code

**L1 Portal** (`eth/contracts/AztecAavePortalL1.sol`):
- `wormholeTokenBridge` - Used for `transferTokensWithPayload` (lines 246-253)
- `wormholeRelayer` - Used for `sendPayloadToEvm` (lines 320-326)
- `targetChainId` - Wormhole chain ID of target (line 67)
- `targetExecutor` - Target executor address (line 70)

**Target Executor** (`target/contracts/AaveExecutorTarget.sol`):
- `wormhole` - VAA verification (line 43)
- `l1PortalAddress` - Expected emitter (line 46)
- `sourceChainId` - Expected source chain (line 49)

---

## Part 3: MVP Simplification Plan

### 3.1 Scope Reduction

**Remove**:
- Target chain (Arbitrum/etc)
- Wormhole bridging
- `AaveExecutorTarget` contract
- `anvil-target` Docker service [DONE - already removed from docker-compose.yml]

**Keep**:
- Aztec L2 (AaveWrapper)
- Ethereum L1 (Portal + Aave)
- L2↔L1 native Aztec messaging

### 3.2 Simplified Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Aztec L2      │     │   Ethereum L1   │     │  Aave on L1     │
│   AaveWrapper   │────▶│   Portal L1     │────▶│   LendingPool   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
    request_deposit()    executeDeposit()           supply()
         │                     │                       │
         ▼                     ▼                       ▼
    L2→L1 message        Consume message          aToken mint
                         & supply to Aave
```

### 3.3 Contract Changes Required

#### 3.3.1 L2 Contract (`aztec/src/main.nr`)

**Changes**:
1. Remove `target_chain_id` from deposit/withdraw functions (always L1)
2. Simplify message content to exclude target chain info
3. Update `DepositIntent` struct
4. Update confirmation content hashes

**Affected functions**:
- `request_deposit()` - lines 342-409
- `finalize_deposit()` - lines 462-514
- `compute_deposit_message_content()` - lines 65-80
- `compute_deposit_confirmation_content()` - lines 99-111
- `compute_intent_id()` - lines 27-47

**Example change** (request_deposit signature):
```noir
// Before
fn request_deposit(asset: Field, amount: u128, original_decimals: u8,
                   target_chain_id: u32, deadline: u64, secret_hash: Field)

// After
fn request_deposit(asset: Field, amount: u128, original_decimals: u8,
                   deadline: u64, secret_hash: Field)
```

#### 3.3.2 L1 Portal (`eth/contracts/AztecAavePortalL1.sol`)

**Remove**:
- `wormholeTokenBridge` (line 58)
- `wormholeRelayer` (line 61)
- `targetChainId` (line 67)
- `targetExecutor` (line 70)
- `receiveWormholeMessages()` function (lines 362-411)
- `completeWithdrawalTransfer()` function (lines 554-605)
- All Wormhole-related imports

**Add**:
- `aaveLendingPool` - Direct reference to Aave on L1
- Direct Aave supply call in `executeDeposit()`
- Direct Aave withdraw call in `executeWithdraw()`

**New executeDeposit flow**:
```solidity
function executeDeposit(...) external {
    // 1. Consume L2→L1 message (existing)
    // 2. Transfer tokens from user (or token portal)
    // 3. Approve Aave pool
    // 4. Supply to Aave directly
    aaveLendingPool.supply(intent.asset, intent.amount, address(this), 0);
    // 5. Send L1→L2 confirmation message
    aztecInbox.sendL2Message(...);
}
```

#### 3.3.3 Remove Target Directory

**Delete entirely**:
- `target/contracts/AaveExecutorTarget.sol`
- `target/contracts/interfaces/`
- `target/contracts/libraries/`
- `target/contracts/mocks/`
- `target/contracts/types/`

**Keep for reference** (can delete later):
- `target/lib/aave-v3-core/` - Useful for Aave interface definitions

### 3.4 Docker Compose Changes

**File**: `docker-compose.yml`

**Status**: ✅ DONE - `anvil-target` service has already been removed. Comments at lines 46-49 indicate:
```yaml
# ============================================================================
# NOTE: anvil-target removed for MVP simplification
# MVP uses direct L2→L1 Aave deposits without cross-chain bridging
# See docs/MVP_RESEARCH.md for details
# ============================================================================
```

**Result**: Only two services remain:
1. `anvil-l1` (port 8545) - Ethereum L1 with Aave
2. `aztec-sandbox` (port 8080) - Aztec PXE (note: external port 8081 mapped to internal 8080)

### 3.5 Mock Contracts for L1

**Required mocks** (keep/create):
- `MockERC20` ✅ exists at `eth/contracts/mocks/MockERC20.sol`
- `MockLendingPool` - Need to **move** from `target/contracts/mocks/` to `eth/contracts/mocks/`

**L1 mocks** (removed as part of L1-only simplification):
- `MockWormholeCore` - REMOVED
- `MockWormholeTokenBridge` - REMOVED
- `MockWormholeRelayer` - REMOVED

### 3.6 Deploy Script Updates

**File**: `scripts/deploy-local.ts`

**Current state**: The deploy script deploys the simplified L1-only architecture:
- L1: MockERC20, AztecAavePortalL1
- Target: MockWormholeCore, MockLendingPool, MockERC20, AaveExecutorTarget
- L2: AaveWrapper

**Changes needed**:
1. Remove target chain deployment section (lines 403-445)
2. Remove Wormhole mock deployments (lines 372-399)
3. Add MockLendingPool deployment on L1
4. Update AztecAavePortalL1 constructor (remove Wormhole params)

---

## Part 4: Frontend Requirements

### 4.1 Technology Stack

| Component | Recommendation |
|-----------|---------------|
| Framework | React + Vite |
| Aztec SDK | `@aztec/aztec.js` (v3.0.0-devnet) |
| L1 SDK | `viem` for Ethereum interactions |
| Styling | Tailwind CSS (simple, fast) |

### 4.2 Core Features

1. **Wallet Connection**
   - Aztec wallet (PXE client)
   - Ethereum wallet (MetaMask/injected)

2. **Deposit Flow UI**
   - Input: Amount, Asset (USDC only for MVP)
   - Display: Current L2 balance
   - Action: Call `request_deposit()`
   - Status: Track intent status

3. **Balance Display**
   - L2 private balance (requires viewing key)
   - L1 aToken balance (public)
   - Position receipt status

4. **Transaction History**
   - Intent ID
   - Status (Pending, Confirmed, Failed)
   - Timestamps

### 4.3 Key Integrations

**Aztec (L2)**:
```typescript
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { AaveWrapperContract } from "./generated/AaveWrapper";

const node = createAztecNodeClient("http://localhost:8081");
const contract = await AaveWrapperContract.at(contractAddress, wallet);
await contract.methods.request_deposit(asset, amount, decimals, targetChainId, deadline, secretHash).send();
```

**Ethereum (L1)**:
```typescript
import { createPublicClient, http } from 'viem';
import { localhost } from 'viem/chains';

const client = createPublicClient({
  chain: localhost,
  transport: http('http://localhost:8545')
});
// Read Aave aToken balance, portal state, etc.
```

### 4.4 Directory Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── WalletConnect.tsx
│   │   ├── DepositForm.tsx
│   │   ├── BalanceDisplay.tsx
│   │   └── TransactionHistory.tsx
│   ├── hooks/
│   │   ├── useAztec.ts
│   │   └── useEthereum.ts
│   ├── lib/
│   │   ├── aztec.ts
│   │   └── ethereum.ts
│   ├── App.tsx
│   └── main.tsx
├── package.json
└── vite.config.ts
```

**Status**: [NOT IMPLEMENTED] - Frontend directory does not exist yet.

---

## Part 5: Implementation Checklist

### Phase 1: Contract Simplification

- [ ] **L2 Contract**
  - [ ] Remove `target_chain_id` parameter from functions
  - [ ] Update `DepositIntent` struct
  - [ ] Update `compute_intent_id()` (lines 27-47)
  - [ ] Update `compute_deposit_message_content()` (lines 65-80)
  - [ ] Update `compute_deposit_confirmation_content()` (lines 99-111)
  - [ ] Update `compute_withdraw_confirmation_content()` (lines 130-142)
  - [ ] Update `compute_withdraw_message_content()` (lines 164-181)
  - [ ] Update unit tests

- [ ] **L1 Portal**
  - [ ] Remove Wormhole dependencies (imports, state variables)
  - [ ] Add `aaveLendingPool` immutable
  - [ ] Rewrite `executeDeposit()` to call Aave directly
  - [ ] Rewrite `executeWithdraw()` to call Aave directly
  - [ ] Remove `receiveWormholeMessages()` (lines 362-411)
  - [ ] Remove `completeWithdrawalTransfer()` (lines 554-605)
  - [ ] Update confirmation message sending
  - [ ] Update unit tests

- [ ] **Remove Target Chain**
  - [ ] Delete `target/contracts/` (keep `target/lib/aave-v3-core/` temporarily)
  - [ ] Update Makefile (remove target-related commands)

### Phase 2: Infrastructure

- [x] **Docker Compose**
  - [x] Remove `anvil-target` service
  - [ ] Verify `anvil-l1` still works
  - [ ] Update any network references

- [ ] **Mock Contracts**
  - [ ] Move `MockLendingPool` to `eth/contracts/mocks/`
  - [ ] Remove Wormhole mocks from `eth/contracts/mocks/`
  - [ ] Update foundry.toml remappings if needed

- [ ] **Deploy Script**
  - [ ] Remove target chain deployment
  - [ ] Remove Wormhole mock deployments
  - [ ] Add MockLendingPool deployment on L1
  - [ ] Update portal constructor call

### Phase 3: Testing

- [ ] **Unit Tests**
  - [ ] Update L1 portal tests
  - [ ] Update L2 contract tests
  - [ ] Remove target executor tests

- [ ] **E2E Tests**
  - [ ] Update `e2e/src/e2e.test.ts` for simplified flow
  - [ ] Update `e2e/src/setup.ts` to deploy fewer contracts
  - [ ] Remove target chain setup

### Phase 4: Frontend

- [ ] **Setup**
  - [ ] Create `frontend/` directory with Vite + React
  - [ ] Install dependencies (`@aztec/aztec.js`, `viem`, etc.)
  - [ ] Configure for devnet endpoints

- [ ] **Components**
  - [ ] Wallet connection (Aztec + Ethereum)
  - [ ] Deposit form
  - [ ] Balance display (L2 private, L1 aToken)
  - [ ] Transaction/intent status tracker

- [ ] **Integration**
  - [ ] Connect to local Aztec PXE
  - [ ] Connect to local Anvil L1
  - [ ] Test full deposit flow

### Phase 5: Documentation

- [ ] Update README.md with simplified architecture
- [ ] Update CLAUDE.md with new commands
- [ ] Create user guide for MVP demo

---

## Part 6: Risk Assessment

### 6.1 Technical Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| L2↔L1 message timing | Medium | Use sandbox auto-block progression |
| Aave mock accuracy | Low | Use official Aave V3 interfaces |
| Private state visibility | Low | Existing aztec.js patterns |

### 6.2 Scope Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Feature creep | High | Strict MVP scope (deposit only) |
| Withdrawal complexity | Medium | Defer to post-MVP |
| Multi-asset support | Low | USDC only for MVP |

---

## Appendix A: File References

### Contracts to Modify

| File | Lines to Change |
|------|-----------------|
| `aztec/src/main.nr` | 27-47 (compute_intent_id), 65-80 (compute_deposit_message_content), 99-111 (compute_deposit_confirmation_content), 130-142 (compute_withdraw_confirmation_content), 164-181 (compute_withdraw_message_content), 342-409 (request_deposit), 462-514 (finalize_deposit), 586-668 (request_withdraw), 735-801 (finalize_withdraw) |
| `aztec/src/types/intent.nr` | Lines 19-36 (DepositIntent struct) |
| `eth/contracts/AztecAavePortalL1.sol` | 58-70 (Wormhole immutables), 203-258 (executeDeposit), 280-329 (executeWithdraw), 362-411 (receiveWormholeMessages), 554-605 (completeWithdrawalTransfer) |
| `eth/contracts/types/Intent.sol` | Remove target_chain_id (but note: DepositIntent struct still has targetChainId at line 26) |
| `docker-compose.yml` | ✅ Already done - anvil-target removed |
| `scripts/deploy-local.ts` | Lines 372-445 (target deployment section) |

### Files to Delete

```
target/contracts/AaveExecutorTarget.sol
target/contracts/interfaces/ILendingPool.sol
target/contracts/interfaces/IWormhole.sol
target/contracts/libraries/WormholeParser.sol
target/contracts/mocks/MockERC20.sol
target/contracts/mocks/MockLendingPool.sol
target/contracts/mocks/MockWormholeCore.sol
target/contracts/types/FailedOperation.sol
target/contracts/types/Intent.sol
eth/contracts/interfaces/IWormholeTokenBridge.sol
eth/contracts/interfaces/IWormholeRelayer.sol
```

### Files to Create

```
frontend/                           [NOT IMPLEMENTED]
eth/contracts/mocks/MockLendingPool.sol (move from target)
```

---

## Appendix B: Message Format Changes

### Current L2→L1 Message (with target chain)

```noir
poseidon2_hash([
    intent.intent_id,
    intent.owner_hash,
    intent.asset,
    intent.amount as Field,
    intent.original_decimals as Field,
    intent.target_chain_id as Field,  // REMOVE
    intent.deadline as Field,
    intent.salt,
    secret_hash,
])
```

### MVP L2→L1 Message (L1 only)

```noir
poseidon2_hash([
    intent.intent_id,
    intent.owner_hash,
    intent.asset,
    intent.amount as Field,
    intent.original_decimals as Field,
    intent.deadline as Field,
    intent.salt,
    secret_hash,
])
```

---

## Appendix C: Deadline Configuration

### Current Values (from L1 Portal)

| Constant | Value | Location |
|----------|-------|----------|
| `MIN_DEADLINE` | 5 minutes | `AztecAavePortalL1.sol:75` |
| `MAX_DEADLINE` | 24 hours | `AztecAavePortalL1.sol:78` |

### Current Values (from L2 Contract)

| Constant | Value | Location |
|----------|-------|----------|
| `MIN_DEADLINE_DURATION` | 30 minutes (1800 seconds) | `main.nr:209` |
| `MAX_DEADLINE_DURATION` | 7 days (604800 seconds) | `main.nr:211` |

**Note**: L1 and L2 have different deadline bounds. CLAUDE.md states "5 min minimum, 24 hour maximum" which matches L1 but not L2.

---

*Document generated: 2025-01-13*
*Based on codebase analysis at commit: 6a891e7*
