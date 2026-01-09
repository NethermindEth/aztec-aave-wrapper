# Aztec Aave Wrapper - Implementation Plan (Specification)

**Status**: Final Specification with Interview Decisions Integrated
**Created**: 2026-01-09
**Based on**: IMPLEMENTATION_PLAN.md + Technical Interview

---

## Overview

This plan implements the Aztec Aave Wrapper MVP following the **spec.md** architecture: a three-layer system (L2 Noir → L1 Portal → Target Executor) using Wormhole for cross-chain bridging.

**Interview-Driven Architecture Decisions**:
- **Single Token MVP**: USDC only (hardcoded asset ID)
- **Full Withdrawal Only**: No partial withdrawals; simplifies note lifecycle
- **Anonymous Pool Model**: Target executor tracks per-intent shares; withdrawals draw from common aToken pool
- **Privacy via hash(ownerL2)**: Owner identity hashed in cross-chain messages; L2 contract stores intentId → owner mapping privately
- **Retry Queue**: On-chain unlimited queue for failed operations; original caller can retry
- **Deadline Bounds**: Enforce min (30 min) and max (7 days) deadline durations
- **Refund Mechanism**: Expired withdrawal requests mint new receipt note
- **Relayer Economics**: User pays relayer costs via msg.value passed through system
- **Deployment Target**: Local devnet only for MVP
- **Testing**: Separate test suites - unit tests with mocks (CI), integration tests with Wormhole testnet
- **Solidity Version**: 0.8.33 (latest stable) everywhere
- **Custodial Risk**: Accepted for MVP; single-contract custody documented

**Open Research Items**:
- Aztec patterns for private owner routing (how to elegantly resolve hash(ownerL2) → ownerL2)
- Validate message_leaf_index API pattern against current Aztec sandbox

**Estimated Steps**: 34 steps across 6 phases

---

## Phase 1: Foundation & Dependency Alignment

Verify and configure all tooling, dependencies, and interfaces to support the 3-layer Wormhole architecture with privacy-preserving design.

### Phase Validation
```bash
make check-tooling
make build
forge --version
aztec --version
bun --version
```

### Step 1: Verify Wormhole dependencies and normalize Solidity versions

#### Goal
Ensure Wormhole contracts and interfaces are available for L1 portal and target executor integration. Normalize all Solidity versions to 0.8.33 (latest stable).

#### Files
- `l1/contracts/interfaces/IWormholeTokenBridge.sol` - Verify transferTokensWithPayload interface exists
- `l1/contracts/interfaces/IWormholeRelayer.sol` - Add if missing (for message relaying)
- `target/contracts/interfaces/IWormhole.sol` - Add Wormhole core interface for VAA parsing
- `shared/wormhole/` - Create shared Wormhole constants (chain IDs, etc.)
- `l1/foundry.toml` - Update `solc_version = "0.8.33"`
- `target/foundry.toml` - Update `solc_version = "0.8.33"`

**Interview Decision**: Use Solidity 0.8.33 everywhere for consistency and latest features. Verify Arbitrum supports 0.8.33.

#### Validation
```bash
cd l1 && forge build --contracts contracts/AztecAavePortalL1.sol
cd target && forge build --contracts contracts/AaveExecutorTarget.sol
grep "solc_version" l1/foundry.toml | grep "0.8.33"
grep "solc_version" target/foundry.toml | grep "0.8.33"
```

#### Failure modes
- Missing IWormholeTokenBridge interface - add from Wormhole SDK
- Solidity 0.8.33 incompatible with target chain EVM - downgrade if needed
- Missing Wormhole contract addresses for local devnet

---

### Step 2: Add Wormhole mock contracts for local testing

#### Goal
Create mock Wormhole contracts to enable local devnet testing without external Wormhole infrastructure. Mocks should simulate VAA generation and token normalization.

#### Files
- `l1/contracts/mocks/MockWormholeTokenBridge.sol` - Mock transferTokensWithPayload with 8-decimal normalization
- `l1/contracts/mocks/MockWormholeRelayer.sol` - Mock message delivery
- `target/contracts/mocks/MockWormholeCore.sol` - Mock VAA verification (signature bypass mode)
- `scripts/deploy-mocks.ts` - Deploy script for local testing

**Interview Decision**: Use signature bypass mode for mocks; integration tests use real Wormhole testnet.

#### Validation
```bash
cd l1 && forge test --match-contract MockWormhole -vv
```

#### Failure modes
- Mock VAA generation complexity - start with signature bypass mode
- Cross-chain message delivery timing issues - add manual delivery triggers
- Token normalization (8 decimals) not mocked properly - test with USDC (6 decimals)

---

### Step 3: Update shared type definitions with privacy and decimals

#### Goal
Define consistent message payload structures across L2, L1, and Target layers matching spec.md §3.2, with hash(ownerL2) for privacy and original decimals for Wormhole denormalization.

#### Files
- `shared/types/Intent.ts` - TypeScript types for DepositIntent, WithdrawIntent
- `aztec_contracts/src/types/intent.nr` - Update to use hash(ownerL2), remove secret/denomination
- `l1/contracts/types/Intent.sol` - Solidity structs with ownerHash and originalDecimals
- `target/contracts/types/Intent.sol` - Same structs for target executor

Example structure (Solidity):
```solidity
struct DepositIntent {
    bytes32 intentId;
    bytes32 ownerHash;      // hash(ownerL2) for privacy
    address asset;
    uint128 amount;
    uint8 originalDecimals; // For Wormhole denormalization
    uint32 targetChainId;
    uint64 deadline;
    bytes32 salt;
}
```

**Interview Decisions**:
- Use hash(ownerL2) instead of plain ownerL2 for privacy
- Store original token decimals in payload to handle Wormhole 8-decimal normalization

#### Validation
```bash
cd l1 && forge test --match-test test_intentEncoding
cd aztec_contracts && aztec test --match-test test_intent_serialization
```

#### Failure modes
- ABI encoding mismatch between Noir and Solidity
- Field size overflow (u128 vs u256)
- ownerHash encoding incompatibility (Poseidon hash format)

---

### Step 4: Configure local devnet with Wormhole mocks and deadline config

#### Goal
Update docker-compose.yml and deployment scripts to include Wormhole mock contracts in local environment. Add deadline configuration contract/storage.

#### Files
- `docker-compose.yml` - Ensure anvil-l1, anvil-target, aztec-sandbox services configured
- `scripts/deploy-local.ts` - Deploy L1 portal + target executor + mocks with deadline configs
- `.env.example` - Add Wormhole contract addresses, MIN_DEADLINE, MAX_DEADLINE
- `Makefile` - Update deploy-local target
- `l1/contracts/AztecAavePortalL1.sol` - Add DeadlineConfig struct and validation

**Interview Decision**: Enforce min (30 min) and max (7 days) deadline durations.

#### Validation
```bash
make devnet-up
make devnet-health
make deploy-local
# Verify Wormhole mocks are deployed and callable
```

#### Failure modes
- Docker networking issues between anvil-l1 and anvil-target
- Contract deployment order (portal needs Wormhole addresses first)
- Missing environment variables in deployment scripts

---

## Phase 2: L2 Contract Refactoring with Privacy

Align the L2 Noir contract with spec.md requirements: use hash(ownerL2), remove secret/denomination logic, implement direct amount deposits, add proper cross-chain message encoding, and implement owner resolution mapping.

### Phase Validation
```bash
cd aztec_contracts && aztec test
cd aztec_contracts && aztec compile
```

### Step 1: Add intentId → owner mapping storage in L2 contract

#### Goal
Implement private storage mapping to track intentId → owner relationship for finalization routing.

#### Files
- `aztec_contracts/src/storage.nr` - Add private mapping: `intent_owners: Map<Field, AztecAddress>`
- `aztec_contracts/src/main.nr` - Import and initialize mapping

**Interview Decision**: Store intentId → ownerL2 mapping at request time for finalization routing.

#### Validation
```bash
cd aztec_contracts && aztec compile
cd aztec_contracts && aztec test --match-test test_storage_mapping
```

#### Failure modes
- Storage slot conflicts with existing state
- Mapping serialization issues
- Gas costs for storage operations

---

### Step 2: Update PositionReceiptNote to remove secret/denomination

#### Goal
Update PositionReceiptNote to match spec.md §3.1 data model without secret/denomination fields, using direct shares amount.

#### Files
- `aztec_contracts/src/types/position_receipt.nr` - Update struct

Before (current):
```noir
struct PositionReceiptNote {
    owner: AztecAddress,
    nonce: Field,
    asset_id: Field,
    denomination: u8,       // REMOVE
    secret: Field,          // REMOVE
    target_chain_id: u32,
    status: u8,
}
```

After (spec-aligned):
```noir
struct PositionReceiptNote {
    owner: AztecAddress,
    nonce: Field,
    asset_id: Field,
    shares: u128,           // ADD: Direct amount/shares
    target_chain_id: u32,
    aave_market_id: Field,  // ADD: Optional market identifier
    status: u8,             // PendingDeposit=0, Active=1, PendingWithdraw=2
}
```

#### Validation
```bash
cd aztec_contracts && aztec compile
cd aztec_contracts && aztec test --match-test test_position_receipt_note
```

#### Failure modes
- Compilation errors due to removed fields referenced elsewhere
- Note hash changes affecting existing test fixtures
- Storage slot changes breaking serialization

---

### Step 3: Update request_deposit to use hash(ownerL2) and direct amounts

#### Goal
Refactor request_deposit function to accept direct amounts, compute hash(ownerL2), store intentId → owner mapping, enforce deadline bounds.

#### Files
- `aztec_contracts/src/main.nr` - Update request_deposit function signature and logic
- `aztec_contracts/src/utils/hash.nr` - Add hash(ownerL2) utility if needed

Before:
```noir
fn request_deposit(
    asset_id: Field,
    denomination: u8,
    secret: Field,
    target_chain_id: u32,
    deadline: u64,
) -> Field
```

After:
```noir
fn request_deposit(
    asset_id: Field,
    amount: u128,
    target_chain_id: u32,
    deadline: u64,
) -> Field {
    // Validate USDC asset_id (hardcoded)
    // Validate amount > 0
    // Validate deadline within MIN/MAX bounds
    // Generate intentId
    // Store intent_owners[intentId] = msg.sender
    // Compute owner_hash = poseidon_hash(msg.sender.to_field())
    // Create L2→L1 message with owner_hash
    // Return intentId
}
```

**Interview Decisions**:
- USDC only (hardcoded asset_id check)
- Store intentId → owner for finalization routing
- Use hash(ownerL2) in message content

#### Validation
```bash
cd aztec_contracts && aztec test --match-test test_request_deposit
cd aztec_contracts && aztec test --match-test test_deadline_validation
```

#### Failure modes
- Amount validation (zero amounts, overflow checks) not implemented
- Deadline validation missing
- Intent ID computation change breaks existing tests

---

### Step 4: Update L2→L1 message encoding with hash(ownerL2)

#### Goal
Modify compute_deposit_message_content to encode DepositIntent with hash(ownerL2) instead of plain owner, matching spec.md §3.2 format.

#### Files
- `aztec_contracts/src/main.nr` - Update compute_deposit_message_content function

Remove secret_hash parameter, use owner_hash:
```noir
pub fn compute_deposit_message_content(intent: DepositIntent) -> Field {
    poseidon2_hash([
        intent.intent_id,
        intent.owner_hash,  // hash(ownerL2) instead of plain owner
        intent.asset_id,
        intent.amount as Field,
        intent.target_chain_id as Field,
        intent.deadline as Field,
        intent.salt as Field,
    ])
}
```

**Interview Decision**: ownerHash included for L1→L2 routing but execution doesn't verify ownership.

#### Validation
```bash
cd aztec_contracts && aztec test --match-test test_message_encoding
# Cross-validate with L1 contract message consumption
```

#### Failure modes
- Hash mismatch with L1 expectation - must align precisely
- ownerHash encoding format issues
- Field overflow for amount values

---

### Step 5: Implement finalize_deposit with owner resolution

#### Goal
Complete finalize_deposit function to consume L1→L2 confirmation messages, resolve owner from mapping, and mint PositionReceiptNote.

#### Files
- `aztec_contracts/src/main.nr` - Implement finalize_deposit logic
- `aztec_contracts/src/test/deposit_tests.nr` - Add finalization tests

Per spec.md §4.1 Step 6:
```noir
fn finalize_deposit(
    intent_id: Field,
    shares: u128,
    message_leaf_index: Field,
) {
    // 1. Consume L1→L2 message from portal
    // 2. Resolve owner from intent_owners[intentId]
    // 3. Verify intent not already finalized
    // 4. Mint PositionReceiptNote(status=Active, shares=shares) to owner
    // 5. Clear intent mapping
}
```

**Interview Decision**: Research Aztec patterns for message routing; fallback to stored mapping.

#### Validation
```bash
cd aztec_contracts && aztec test --match-test test_finalize_deposit
```

#### Failure modes
- Message leaf index not found (timing issue with L1 message propagation)
- Double finalization not prevented (replay protection)
- Note encryption fails for owner
- Owner resolution fails if mapping cleared prematurely

---

### Step 6: Implement withdraw functions with status tracking

#### Goal
Implement request_withdraw and finalize_withdraw functions per spec.md §4.2. Update receipt status to PendingWithdraw (don't nullify until finalized).

#### Files
- `aztec_contracts/src/main.nr` - Implement both functions
- `aztec_contracts/src/types/intent.nr` - Add WithdrawIntent struct
- `aztec_contracts/src/test/withdraw_tests.nr` - Add comprehensive tests

request_withdraw:
```noir
fn request_withdraw(
    receipt_note: PositionReceiptNote,
    amount: u128,
    deadline: u64,
) -> Field {
    // 1. Verify receipt is Active
    // 2. Verify amount == receipt.shares (full withdrawal only)
    // 3. Update receipt status to PendingWithdraw (DON'T nullify)
    // 4. Create WithdrawIntent
    // 5. Store intent_owners[withdrawIntentId] = msg.sender
    // 6. Send L2→L1 message
    // 7. Return withdrawIntentId
}
```

finalize_withdraw:
```noir
fn finalize_withdraw(
    intent_id: Field,
    amount_received: u128,
    message_leaf_index: Field,
) {
    // 1. Consume L1→L2 completion message
    // 2. Resolve owner from mapping
    // 3. Nullify receipt note
    // 4. Credit user's L2 token balance (via token portal)
    // 5. Clear intent mapping
}
```

**Interview Decision**: Full withdrawal only; receipt status PendingWithdraw until finalized.

#### Validation
```bash
cd aztec_contracts && aztec test --match-test test_withdraw
cd aztec_contracts && aztec test --match-test test_full_withdrawal_only
```

#### Failure modes
- Receipt note not found or already consumed
- Partial withdrawal attempted (should revert)
- L1→L2 token deposit fails (token portal issues)

---

### Step 7: Implement deadline expiry refund mechanism

#### Goal
Add claim_refund function to mint new receipt note when withdrawal request expires without processing.

#### Files
- `aztec_contracts/src/main.nr` - Add claim_refund function
- `aztec_contracts/src/test/refund_tests.nr` - Add tests

```noir
fn claim_refund(
    withdraw_intent_id: Field,
) {
    // 1. Verify intent exists in pending state
    // 2. Verify block.timestamp > deadline
    // 3. Verify not already processed or refunded
    // 4. Mint NEW PositionReceiptNote with original shares to owner
    // 5. Mark intent as refunded
}
```

**Interview Decision**: Mint new note (simpler than unnullifying original).

#### Validation
```bash
cd aztec_contracts && aztec test --match-test test_deadline_refund
```

#### Failure modes
- Refund claimed before deadline expires
- Double refund prevented
- New note has same nullifier as original (should be different)

---

## Phase 3: L1 Portal Implementation

Implement the Ethereum L1 portal contract to consume Aztec outbox messages, bridge via Wormhole to target chain with relayer fee handling, and handle return confirmations.

### Phase Validation
```bash
cd l1 && forge test -vv
cd l1 && forge coverage
```

### Step 1: Implement executeDeposit with Aztec outbox consumption and deadline validation

#### Goal
Implement executeDeposit function to consume L2→L1 messages, validate intents with min/max deadline bounds, per spec.md §4.1 Step 2.

#### Files
- `l1/contracts/AztecAavePortalL1.sol` - Implement executeDeposit function with DeadlineConfig
- `l1/test/Portal.executeDeposit.t.sol` - Comprehensive tests

```solidity
struct DeadlineConfig {
    uint64 minDuration;  // 30 minutes
    uint64 maxDuration;  // 7 days
}

function executeDeposit(
    DepositIntent calldata intent,
    bytes32 messageHash,
    uint256 leafIndex,
    bytes32[] calldata siblingPath
) external payable whenNotPaused {
    // 1. Verify deadline not passed
    if (block.timestamp > intent.deadline) revert DeadlinePassed();

    // 2. Verify deadline was within allowed bounds
    // (This requires tracking request time or accepting any valid deadline)

    // 3. Check not already consumed
    if (consumedIntents[intent.intentId]) revert IntentAlreadyConsumed(intent.intentId);

    // 4. Consume message from Aztec outbox (proof provided by aztec.js SDK)
    bytes32 expectedHash = keccak256(abi.encode(intent));
    IAztecOutbox(aztecOutbox).consume(
        l2ContractAddress,
        messageHash,
        expectedHash,
        leafIndex,
        siblingPath
    );

    // 5. Mark consumed atomically
    consumedIntents[intent.intentId] = true;

    // 6. Continue to Wormhole bridging (next step)
}
```

**Interview Decisions**:
- Enforce min/max deadline bounds (30 min to 7 days)
- Relayer provides msg.value for Wormhole fees
- Aztec SDK handles proof construction

#### Validation
```bash
cd l1 && forge test --match-test test_executeDeposit -vvv
cd l1 && forge test --match-test test_deadlineValidation -vvv
```

#### Failure modes
- Message hash mismatch (encoding differs from L2)
- Outbox message not available yet (timing issue - relayer retries)
- Replay attack if consumedIntents not set atomically
- Invalid siblingPath causing consume to fail
- Insufficient msg.value for Wormhole fees

---

### Step 2: Add Wormhole token bridging with original decimals

#### Goal
Integrate Wormhole transferTokensWithPayload to bridge tokens and message to target chain, encoding original decimals for denormalization (spec.md §4.1 Step 2, §6 Mode B).

#### Files
- `l1/contracts/AztecAavePortalL1.sol` - Extend executeDeposit with Wormhole call
- `l1/contracts/interfaces/IWormholeTokenBridge.sol` - Verify transferTokensWithPayload signature

After Aztec message consumption, add:
```solidity
    // 6. Withdraw tokens from Aztec token portal
    uint256 amount = ITokenPortal(tokenPortal).withdraw(
        intent.asset,
        intent.amount
    );

    // 7. Approve Wormhole bridge
    IERC20(intent.asset).approve(wormholeTokenBridge, amount);

    // 8. Encode payload with original decimals for denormalization
    bytes memory payload = abi.encode(
        intent.intentId,
        intent.asset,
        intent.amount,
        intent.originalDecimals,  // ADD: For target to denormalize
        uint8(0),                 // action: DEPOSIT
        intent.deadline
    );

    // 9. Bridge via Wormhole transferTokensWithPayload
    uint64 sequence = IWormholeTokenBridge(wormholeTokenBridge)
        .transferTokensWithPayload{value: msg.value}(
            intent.asset,
            amount,
            targetChainId,
            targetExecutor,
            0, // nonce
            payload
        );

    emit DepositInitiated(intent.intentId, intent.asset, amount, targetChainId);
}
```

**Interview Decision**: Store original decimals in payload for Wormhole denormalization on target.

#### Validation
```bash
cd l1 && forge test --match-test test_executeDeposit_wormholeBridge -vvv
cd l1 && forge test --match-test test_decimals_encoding -vvv
```

#### Failure modes
- Token portal withdraw fails (insufficient L2 balance)
- Wormhole bridge reverts (insufficient msg.value for fees)
- Token normalization issues (Wormhole uses 8 decimals internally)
- Target executor address format incorrect (bytes32 vs address)
- Original decimals not preserved correctly

---

### Step 3: Implement executeWithdraw with Wormhole messaging

#### Goal
Implement executeWithdraw to send withdrawal requests to target chain per spec.md §4.2 Step 2.

#### Files
- `l1/contracts/AztecAavePortalL1.sol` - Implement executeWithdraw function
- `l1/test/Portal.executeWithdraw.t.sol` - Tests

```solidity
function executeWithdraw(
    WithdrawIntent calldata intent,
    bytes32 messageHash,
    uint256 leafIndex,
    bytes32[] calldata siblingPath
) external payable whenNotPaused {
    // 1-4. Same message consumption logic as executeDeposit

    // 5. Encode withdrawal payload
    bytes memory payload = abi.encode(
        intent.intentId,
        intent.asset,
        intent.amount,
        uint8(1), // action: WITHDRAW
        intent.deadline
    );

    // 6. Send message-only via Wormhole relayer
    // (No token transfer on this direction - tokens come back later)
    IWormholeRelayer(wormholeRelayer).sendPayloadToEvm{value: msg.value}(
        targetChainId,
        targetExecutor,
        payload,
        0, // no receiver value
        0  // no gas limit override
    );

    emit WithdrawInitiated(intent.intentId, intent.amount);
}
```

#### Validation
```bash
cd l1 && forge test --match-test test_executeWithdraw -vvv
```

#### Failure modes
- Insufficient msg.value for Wormhole relayer fees
- Wormhole relayer not configured for target chain
- Payload encoding mismatch with target executor expectation

---

### Step 4: Implement receiveWormholeMessages for confirmations

#### Goal
Add function to receive Wormhole VAA messages from target executor with deposit confirmations (spec.md §4.1 Step 5).

#### Files
- `l1/contracts/AztecAavePortalL1.sol` - Add receiveWormholeMessages function
- `l1/contracts/types/Confirmation.sol` - Define confirmation structs

```solidity
function receiveWormholeMessages(
    bytes memory payload,
    bytes[] memory additionalMessages,
    bytes32 sourceAddress,
    uint16 sourceChain,
    bytes32 deliveryHash
) external payable {
    // 1. Verify caller is Wormhole relayer
    require(msg.sender == wormholeRelayer, "Invalid caller");

    // 2. Verify source is target executor
    require(sourceAddress == targetExecutor && sourceChain == targetChainId, "Invalid source");

    // 3. Decode confirmation
    (bytes32 intentId, bool success, uint256 shares) = abi.decode(
        payload,
        (bytes32, bool, uint256)
    );

    // 4. Send L1→L2 message to finalize (with ownerHash for routing)
    // NOTE: ownerHash not available here - target doesn't send it back
    // L2 contract uses intentId → owner mapping
    IAztecInbox(aztecInbox).sendL2Message(
        l2ContractAddress,
        abi.encode(intentId, shares)
    );

    emit DepositConfirmed(intentId, shares);
}
```

#### Validation
```bash
cd l1 && forge test --match-test test_receiveConfirmation -vvv
```

#### Failure modes
- Wormhole relayer impersonation (authentication critical)
- deliveryHash replay attacks (need tracking)
- L1→L2 message send fails (Aztec inbox issues)
- Owner resolution on L2 fails if mapping cleared

---

### Step 5: Implement completeTransferWithPayload for withdrawal completions

#### Goal
Add function to receive bridged tokens back from target executor on withdrawals (spec.md §4.2 Step 4).

#### Files
- `l1/contracts/AztecAavePortalL1.sol` - Add completeTransferWithPayload function

```solidity
function completeTransferWithPayload(
    bytes memory encodedVm
) external {
    // 1. Parse and verify VAA
    (IWormholeTokenBridge.TransferWithPayload memory transfer) =
        IWormholeTokenBridge(wormholeTokenBridge).completeTransferWithPayload(encodedVm);

    // 2. Decode payload to get intentId
    (bytes32 intentId, uint256 amountReceived) = abi.decode(
        transfer.payload,
        (bytes32, uint256)
    );

    // 3. Deposit tokens to Aztec token portal for L2 credit
    IERC20(transfer.tokenAddress).approve(tokenPortal, amountReceived);
    ITokenPortal(tokenPortal).deposit(
        transfer.tokenAddress,
        amountReceived,
        bytes32(0) // recipient determined by L2 contract
    );

    // 4. Send L1→L2 finalization message
    IAztecInbox(aztecInbox).sendL2Message(
        l2ContractAddress,
        abi.encode(intentId, amountReceived)
    );

    emit WithdrawCompleted(intentId, amountReceived);
}
```

#### Validation
```bash
cd l1 && forge test --match-test test_completeWithdrawal -vvv
```

#### Failure modes
- VAA verification fails (Wormhole Guardian signatures invalid)
- Token portal deposit reverts
- Amount received less than expected (slippage/fees)

---

### Step 6: Add emergency pause and admin functions

#### Goal
Add safety mechanisms: pause (blocks new operations only), emergency withdrawal, admin functions.

#### Files
- `l1/contracts/AztecAavePortalL1.sol` - Add Pausable, Ownable
- `l1/test/Portal.admin.t.sol` - Test admin functions

```solidity
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract AztecAavePortalL1 is Pausable, Ownable {
    // Add whenNotPaused modifiers to executeDeposit, executeWithdraw
    // receiveWormholeMessages and completeTransferWithPayload NOT paused

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        require(paused(), "Must pause first");
        IERC20(token).transfer(owner(), amount);
    }
}
```

**Interview Decision**: Pause blocks new operations only; in-flight operations can complete.

#### Validation
```bash
cd l1 && forge test --match-test test_pause -vv
cd l1 && forge test --match-test test_emergencyWithdraw -vv
cd l1 && forge test --match-test test_pauseAllowsInFlight -vv
```

#### Failure modes
- Pause breaks in-flight operations (should allow finalization)
- Emergency withdraw misused (governance needed for production)

---

## Phase 4: Target Executor Implementation

Implement the target chain executor contract to receive Wormhole messages/tokens, execute Aave operations with per-intent tracking, handle failures with retry queue, and send confirmations back.

### Phase Validation
```bash
cd target && forge test -vv
cd target && forge coverage
```

### Step 1: Implement VAA verification and replay protection

#### Goal
Add Wormhole VAA parsing, signature verification, and replay protection per spec.md §5.3.

#### Files
- `target/contracts/AaveExecutorTarget.sol` - Add VAA verification
- `target/contracts/libraries/WormholeParser.sol` - VAA parsing utilities

```solidity
contract AaveExecutorTarget {
    IWormhole public immutable wormholeCore;

    // Replay protection
    mapping(bytes32 => bool) public consumedVAAs;

    modifier onlyWormhole(bytes memory encodedVm) {
        // 1. Parse VAA
        (IWormhole.VM memory vm, bool valid, string memory reason) =
            wormholeCore.parseAndVerifyVM(encodedVm);

        require(valid, reason);

        // 2. Check not replayed (BEFORE external calls)
        bytes32 vaaHash = keccak256(encodedVm);
        require(!consumedVAAs[vaaHash], "VAA already consumed");
        consumedVAAs[vaaHash] = true;

        // 3. Verify emitter is L1 portal
        require(vm.emitterAddress == l1PortalAddress, "Invalid emitter");

        _;
    }
}
```

#### Validation
```bash
cd target && forge test --match-test test_vaaVerification -vvv
cd target && forge test --match-test test_replayProtection -vvv
```

#### Failure modes
- Invalid VAA signatures (Guardian key mismatch in testnet)
- Replay attack if consumedVAAs not set before external calls
- Emitter address format mismatch (bytes32 vs address)

---

### Step 2: Add retry queue state structures

#### Goal
Implement on-chain unlimited retry queue for failed operations with original caller tracking.

#### Files
- `target/contracts/AaveExecutorTarget.sol` - Add state variables and structs
- `target/contracts/types/FailedOperation.sol` - Define struct

```solidity
struct FailedOperation {
    bytes32 intentId;
    address asset;
    uint256 amount;
    uint8 operationType;    // 0=deposit, 1=withdraw
    address originalCaller;
    uint256 timestamp;
}

// State variables
mapping(bytes32 => uint256) public intentShares;  // Per-intent share tracking
mapping(bytes32 => FailedOperation) public failedOperations;
```

**Interview Decision**: Unlimited on-chain queue; original caller can retry.

#### Validation
```bash
cd target && forge test --match-test test_queueStructures -vv
```

#### Failure modes
- Gas costs for queue operations
- Storage growth unbounded

---

### Step 3: Implement consumeAndExecuteDeposit with denormalization and retry queue

#### Goal
Implement deposit execution: receive tokens from Wormhole, denormalize using original decimals, supply to Aave, track per-intent shares, send confirmation back (spec.md §4.1 Step 3-4). On failure, add to retry queue.

#### Files
- `target/contracts/AaveExecutorTarget.sol` - Implement consumeAndExecuteDeposit
- `target/test/Executor.deposit.t.sol` - Tests

```solidity
function consumeAndExecuteDeposit(
    bytes memory encodedVm
) external onlyWormhole(encodedVm) {
    // 1. Parse Wormhole token transfer payload
    IWormholeTokenBridge.TransferWithPayload memory transfer =
        parseTokenTransfer(encodedVm);

    // 2. Decode intent from payload
    (bytes32 intentId, address asset, uint256 amount, uint8 originalDecimals, uint8 action, uint64 deadline) =
        abi.decode(transfer.payload, (bytes32, address, uint256, uint8, uint8, uint64));

    require(action == 0, "Invalid action"); // DEPOSIT
    require(block.timestamp <= deadline, "Deadline passed");

    // 3. Denormalize amount from Wormhole 8 decimals
    uint256 actualAmount = amount;
    if (originalDecimals > 8) {
        actualAmount = amount * (10 ** (originalDecimals - 8));
    } else if (originalDecimals < 8) {
        actualAmount = amount / (10 ** (8 - originalDecimals));
    }

    // 4. Try Aave supply
    try this._supplyToAave(asset, actualAmount) returns (uint256 shares) {
        // Success: track per-intent shares
        intentShares[intentId] = shares;
        _sendConfirmation(intentId, true, shares);
        emit DepositExecuted(intentId, shares);
    } catch Error(string memory reason) {
        // Failure: add to retry queue
        failedOperations[intentId] = FailedOperation({
            intentId: intentId,
            asset: asset,
            amount: actualAmount,
            operationType: 0,
            originalCaller: msg.sender,
            timestamp: block.timestamp
        });
        emit DepositFailed(intentId, reason);
    }
}

function _supplyToAave(address asset, uint256 amount) external returns (uint256) {
    require(msg.sender == address(this), "Internal only");
    IERC20(asset).approve(address(aavePool), amount);
    aavePool.supply(asset, amount, address(this), 0);
    return amount; // For MVP, shares == principal
}
```

**Interview Decisions**:
- Denormalize using stored original decimals
- Track per-intent shares (not aggregate)
- Failed operations go to retry queue with original caller

#### Validation
```bash
cd target && forge test --match-test test_deposit_success -vvv
cd target && forge test --match-test test_deposit_aaveRevert_queued -vvv
cd target && forge test --match-test test_denormalization -vvv
```

#### Failure modes
- Aave supply reverts (pool paused, supply cap reached)
- Insufficient relayer fee for return message
- Token address mismatch (Wormhole normalized vs actual)
- Denormalization math overflow/underflow

---

### Step 4: Implement retryFailedOperation

#### Goal
Allow original caller to retry failed operations from the queue.

#### Files
- `target/contracts/AaveExecutorTarget.sol` - Implement retry function
- `target/test/Executor.retry.t.sol` - Tests

```solidity
function retryFailedOperation(bytes32 intentId) external payable {
    FailedOperation memory op = failedOperations[intentId];
    require(op.originalCaller == msg.sender, "Only original caller");
    require(op.timestamp != 0, "Operation not found");

    // Attempt re-execution based on operation type
    if (op.operationType == 0) {
        // Deposit retry
        try this._supplyToAave(op.asset, op.amount) returns (uint256 shares) {
            intentShares[intentId] = shares;
            _sendConfirmation(intentId, true, shares);
            delete failedOperations[intentId];
            emit DepositRetried(intentId, true);
        } catch {
            revert("Retry failed");
        }
    } else {
        // Withdrawal retry
        try aavePool.withdraw(op.asset, op.amount, address(this)) returns (uint256 withdrawn) {
            _bridgeWithdrawalTokens(intentId, op.asset, withdrawn);
            delete failedOperations[intentId];
            emit WithdrawRetried(intentId, true);
        } catch {
            revert("Retry failed");
        }
    }
}
```

**Interview Decision**: Original caller only can retry (not permissionless).

#### Validation
```bash
cd target && forge test --match-test test_retry_success -vvv
cd target && forge test --match-test test_retry_onlyOriginalCaller -vvv
```

#### Failure modes
- Retry fails again (persistent issue)
- Gas estimation incorrect
- Original caller cannot afford retry

---

### Step 5: Implement consumeAndExecuteWithdraw with anonymous pool

#### Goal
Implement withdrawal: receive message, withdraw from Aave using per-intent shares, bridge tokens back to L1 (spec.md §4.2 Step 3). Anonymous pool model.

#### Files
- `target/contracts/AaveExecutorTarget.sol` - Implement consumeAndExecuteWithdraw
- `target/test/Executor.withdraw.t.sol` - Tests

```solidity
function consumeAndExecuteWithdraw(
    bytes memory encodedVm
) external payable onlyWormhole(encodedVm) {
    // 1. Parse message (no token transfer on this leg)
    IWormhole.VM memory vm = parseMessage(encodedVm);

    // 2. Decode withdrawal intent
    (bytes32 intentId, address asset, uint256 amount, uint8 action, uint64 deadline) =
        abi.decode(vm.payload, (bytes32, address, uint256, uint8, uint64));

    require(action == 1, "Invalid action"); // WITHDRAW
    require(block.timestamp <= deadline, "Deadline passed");

    // 3. Verify shares exist for this intent (anonymous pool model)
    require(intentShares[intentId] >= amount, "Insufficient shares");

    // 4. Try Aave withdrawal
    try aavePool.withdraw(asset, amount, address(this)) returns (uint256 withdrawn) {
        // 5. Update tracking
        intentShares[intentId] -= amount;

        // 6. Bridge tokens back to L1 portal
        IERC20(asset).approve(wormholeTokenBridge, withdrawn);
        bytes memory payload = abi.encode(intentId, withdrawn);

        IWormholeTokenBridge(wormholeTokenBridge).transferTokensWithPayload{value: msg.value}(
            asset,
            withdrawn,
            l1ChainId,
            l1PortalAddress,
            0,
            payload
        );

        emit WithdrawExecuted(intentId, withdrawn);
    } catch Error(string memory reason) {
        // Failure: add to retry queue
        failedOperations[intentId] = FailedOperation({
            intentId: intentId,
            asset: asset,
            amount: amount,
            operationType: 1,
            originalCaller: msg.sender,
            timestamp: block.timestamp
        });
        emit WithdrawFailed(intentId, reason);
    }
}
```

**Interview Decision**: Anonymous pool - withdrawals draw from any intent's shares.

#### Validation
```bash
cd target && forge test --match-test test_withdraw_success -vvv
cd target && forge test --match-test test_withdraw_insufficientShares -vvv
```

#### Failure modes
- Aave liquidity insufficient for withdrawal
- Shares tracking out of sync with actual aToken balance
- Bridge back fails (stuck tokens in executor)

---

### Step 6: Add position query functions

#### Goal
Implement position queries that show per-intent shares and current value per spec.md §3.1.

#### Files
- `target/contracts/AaveExecutorTarget.sol` - Add getPositionValue function
- `target/contracts/interfaces/IAToken.sol` - Import Aave aToken interface

```solidity
function getPositionValue(bytes32 intentId, address asset) external view returns (uint256 shares, uint256 currentValue) {
    shares = intentShares[intentId];

    // Get actual aToken balance (includes accrued yield)
    IAToken aToken = IAToken(aavePool.getReserveData(asset).aTokenAddress);

    // For MVP: return shares only
    // currentValue could be proportional share of total aToken balance
    currentValue = shares; // Simplified for MVP

    return (shares, currentValue);
}
```

**Interview Decision**: Track per-intent shares for accountability.

#### Validation
```bash
cd target && forge test --match-test test_positionValue -vv
```

#### Failure modes
- aToken address lookup fails (reserve not initialized)
- Yield calculation overflow for large positions
- Multiple intents aggregated incorrectly

---

## Phase 5: E2E Integration Testing

Implement comprehensive end-to-end tests orchestrating all three layers with real Aztec PXE and Wormhole testnet (integration suite) + mocks (CI suite).

### Phase Validation
```bash
make devnet-up
make devnet-health
make deploy-local
make e2e
```

### Step 1: Setup E2E test infrastructure with separate test suites

#### Goal
Create test harness with deployed contracts, funded accounts, and helper utilities. Configure separate unit (mock) and integration (Wormhole testnet) suites.

#### Files
- `e2e/src/setup.ts` - Deploy all contracts and setup accounts
- `e2e/src/utils/aztec.ts` - Aztec PXE interaction helpers
- `e2e/src/utils/wormhole-mock.ts` - Wormhole VAA generation/mocking for unit tests
- `e2e/src/utils/wormhole-testnet.ts` - Real Wormhole testnet interaction for integration
- `e2e/src/config.ts` - Environment configuration
- `e2e/jest.config.js` - Separate test suites configuration

**Interview Decision**: Separate test suites - unit with mocks (CI), integration with Wormhole testnet.

#### Validation
```bash
cd e2e && bun run test:setup
```

#### Failure modes
- Contract deployment order wrong (missing dependencies)
- PXE not ready (Aztec sandbox still syncing)
- Mock Wormhole contracts not deployed
- Wormhole testnet unreachable for integration tests

---

### Step 2: Test full deposit flow with privacy verification

#### Goal
Test complete deposit: L2 request → L1 bridge → Target Aave supply → L1 confirm → L2 finalize (spec.md §4.1). Verify privacy: different relayer executes.

#### Files
- `e2e/src/e2e.test.ts` - Add test_fullDepositFlow
- `e2e/src/flows/deposit.ts` - Deposit orchestration helpers

```typescript
test('full deposit flow with privacy', async () => {
    const { l2Contract, l1Portal, targetExecutor, userWallet, relayerWallet } = await setupE2E();

    // Step 1: User requests deposit on L2
    const amount = 1000n * 10n**6n; // 1000 USDC
    const txReceipt = await l2Contract.methods
        .request_deposit(USDC_ASSET_ID, amount, TARGET_CHAIN_ID, deadline)
        .send({ from: userWallet.getAddress() })
        .wait();

    const intentId = extractIntentId(txReceipt);

    // Step 2: Wait for L2→L1 message to propagate
    await waitForAztecOutboxMessage(intentId);

    // Step 3: Different relayer executes deposit on L1 (privacy)
    const intent = buildDepositIntent(intentId, amount);
    const l1Tx = await l1Portal.connect(relayerWallet).executeDeposit(intent, messageProof, {
        value: WORMHOLE_FEE
    });

    // Verify L1 tx sender is relayer, not user
    expect(l1Tx.from).toBe(relayerWallet.address);
    expect(l1Tx.from).not.toBe(deriveL1Address(userWallet));

    // Step 4: Mock/real Wormhole delivery to target
    const vaa = await mockOrTestnetWormholeVAA(intent);
    await targetExecutor.consumeAndExecuteDeposit(vaa);

    // Step 5: Verify Aave supply happened
    const shares = await targetExecutor.intentShares(intentId);
    expect(shares).toBeGreaterThanOrEqual(amount);

    // Step 6: Confirmation delivery back to L1
    await deliverConfirmation(l1Portal, intentId, shares);

    // Step 7: Finalize on L2
    await waitForAztecInboxMessage(intentId);
    await l2Contract.methods.finalize_deposit(intentId, shares, messageLeafIndex).send().wait();

    // Step 8: Verify receipt note exists and is Active
    const notes = await userWallet.getNotes(l2Contract.address);
    const receipt = notes.find(n => n.intentId === intentId);
    expect(receipt).toBeDefined();
    expect(receipt.status).toBe(PositionStatus.Active);
    expect(receipt.shares).toBe(shares);
});
```

**Interview Decision**: Privacy test: relayer ≠ user executes L1 transaction.

#### Validation
```bash
cd e2e && bun run test --match "full deposit flow"
```

#### Failure modes
- Timing issues (messages not propagated yet) - add retry logic
- Mock/testnet Wormhole VAA format incorrect
- Note decryption fails (PXE key sync issue)

---

### Step 3: Test full withdrawal flow

#### Goal
Test complete withdrawal: L2 request → L1 message → Target Aave withdraw → Bridge back → L2 finalize (spec.md §4.2).

#### Files
- `e2e/src/e2e.test.ts` - Add test_fullWithdrawalFlow
- `e2e/src/flows/withdraw.ts` - Withdrawal orchestration helpers

```typescript
test('full withdrawal flow', async () => {
    // Prerequisite: Complete deposit first
    const { intentId, receipt } = await completeDeposit();

    // Step 1: Request full withdrawal on L2
    const withdrawAmount = receipt.shares; // Full withdrawal only
    const withdrawReceipt = await l2Contract.methods
        .request_withdraw(receipt, withdrawAmount, deadline)
        .send()
        .wait();

    const withdrawIntentId = extractIntentId(withdrawReceipt);

    // Step 2: Execute on L1
    await waitForAztecOutboxMessage(withdrawIntentId);
    await l1Portal.executeWithdraw(withdrawIntent, messageProof, { value: WORMHOLE_FEE });

    // Step 3: Execute on target - Aave withdraw
    const withdrawVAA = await mockOrTestnetWormholeMessageVAA(withdrawIntent);
    await targetExecutor.consumeAndExecuteWithdraw(withdrawVAA, { value: WORMHOLE_FEE });

    // Step 4: Tokens bridged back to L1
    const transferVAA = await mockOrTestnetWormholeTokenTransfer(withdrawIntentId, withdrawAmount);
    await l1Portal.completeTransferWithPayload(transferVAA);

    // Step 5: Finalize on L2
    await waitForAztecInboxMessage(withdrawIntentId);
    await l2Contract.methods.finalize_withdraw(withdrawIntentId, withdrawAmount, messageLeafIndex).send().wait();

    // Step 6: Verify L2 private balance restored
    const finalBalance = await userWallet.getBalance(USDC_ASSET_ID);
    expect(finalBalance).toBeGreaterThanOrEqual(initialBalance + withdrawAmount);
});
```

#### Validation
```bash
cd e2e && bun run test --match "full withdrawal flow"
```

#### Failure modes
- Token portal deposit fails (approval issue)
- L2 balance not updated (note minting failed)
- Receipt note not properly updated to PendingWithdraw

---

### Step 4: Test deadline expiry refund mechanism

#### Goal
Test deadline expiry and refund claim flow.

#### Files
- `e2e/src/e2e.test.ts` - Add test_deadlineRefund

```typescript
test('deadline expiry refund', async () => {
    // Complete deposit
    const { receipt } = await completeDeposit();

    // Request withdrawal with short deadline
    const shortDeadline = Math.floor(Date.now() / 1000) + 60; // 1 minute
    const withdrawReceipt = await l2Contract.methods
        .request_withdraw(receipt, receipt.shares, shortDeadline)
        .send()
        .wait();

    const withdrawIntentId = extractIntentId(withdrawReceipt);

    // Wait for deadline to expire (don't process withdrawal)
    await sleep(70000); // 70 seconds

    // Claim refund
    await l2Contract.methods.claim_refund(withdrawIntentId).send().wait();

    // Verify new receipt note created
    const notes = await userWallet.getNotes(l2Contract.address);
    const refundReceipt = notes.find(n => n.shares === receipt.shares && n.status === PositionStatus.Active);
    expect(refundReceipt).toBeDefined();
    expect(refundReceipt.nonce).not.toBe(receipt.nonce); // Different note
});
```

**Interview Decision**: Mint new note on refund (simpler than unnullify).

#### Validation
```bash
cd e2e && bun run test --match "deadline refund"
```

#### Failure modes
- Refund claimed before deadline expires (should revert)
- New note conflicts with existing note

---

### Step 5: Test failure scenarios with retry

#### Goal
Test edge cases: Aave failures with retry queue, replay attacks, deadline expiry.

#### Files
- `e2e/src/e2e.test.ts` - Add multiple failure tests

```typescript
test('Aave supply failure with retry', async () => {
    // Setup: Pause Aave pool to force failure
    await aavePool.connect(admin).pause();

    const { intentId } = await requestDepositOnL2();
    await l1Portal.executeDeposit(intent, messageProof);

    // Wormhole delivery to target
    await targetExecutor.consumeAndExecuteDeposit(vaa);

    // Verify: Failed operation in queue
    const failedOp = await targetExecutor.failedOperations(intentId);
    expect(failedOp.intentId).toBe(intentId);
    expect(failedOp.originalCaller).toBe(relayer.address);

    // Unpause Aave
    await aavePool.connect(admin).unpause();

    // Retry (only original caller can)
    await targetExecutor.connect(relayer).retryFailedOperation(intentId);

    // Verify success
    const shares = await targetExecutor.intentShares(intentId);
    expect(shares).toBeGreaterThan(0);
});

test('replay attack prevented', async () => {
    const { intentId } = await completeDeposit();

    // Try to execute the same intent again
    await expect(
        l1Portal.executeDeposit(intent, messageProof)
    ).rejects.toThrow('IntentAlreadyConsumed');
});

test('expired deadline rejected', async () => {
    const expiredDeadline = Math.floor(Date.now() / 1000) - 3600;
    await l2Contract.methods
        .request_deposit(USDC_ASSET_ID, 1000, TARGET_CHAIN_ID, expiredDeadline)
        .send()
        .wait();

    await waitForAztecOutboxMessage();

    await expect(
        l1Portal.executeDeposit(intent, messageProof)
    ).rejects.toThrow('DeadlinePassed');
});
```

**Interview Decisions**:
- Original caller can retry
- Replay protection at all layers
- Deadline validation on L1

#### Validation
```bash
cd e2e && bun run test --match "failure"
```

#### Failure modes
- Test doesn't properly simulate failure condition
- Error messages don't match expected strings
- Cleanup between tests incomplete (state leakage)

---

### Step 6: Test multi-user concurrent operations

#### Goal
Test concurrent operations from multiple users maintain isolation with anonymous pool model.

#### Files
- `e2e/src/e2e.test.ts` - Add multi-user tests

```typescript
test('multi-user: concurrent deposits maintain isolation', async () => {
    const userA = await createAztecWallet(pxe);
    const userB = await createAztecWallet(pxe);

    await fundPrivateBalance(userA, USDC, 5000);
    await fundPrivateBalance(userB, USDC, 3000);

    // Both users deposit simultaneously
    const [intentA, intentB] = await Promise.all([
        requestDeposit(userA, 2000),
        requestDeposit(userB, 1500),
    ]);

    // Execute both via relayer
    await Promise.all([
        completeDeposit(intentA),
        completeDeposit(intentB),
    ]);

    // Verify isolation: each user has their own receipt
    const receiptsA = await getUserReceipts(userA);
    const receiptsB = await getUserReceipts(userB);

    expect(receiptsA).toHaveLength(1);
    expect(receiptsB).toHaveLength(1);
    expect(receiptsA[0].shares).toBe(2000);
    expect(receiptsB[0].shares).toBe(1500);

    // Verify target executor per-intent tracking
    const sharesA = await targetExecutor.intentShares(intentA);
    const sharesB = await targetExecutor.intentShares(intentB);
    expect(sharesA).toBe(2000);
    expect(sharesB).toBe(1500);
});
```

**Interview Decision**: Per-intent share tracking on target (not aggregate by owner).

#### Validation
```bash
cd e2e && bun run test --match "multi-user"
```

#### Failure modes
- Race conditions in concurrent operations
- State corruption when multiple users interact
- Share tracking doesn't isolate properly

---

## Phase 6: Documentation and Finalization

Update all documentation to reflect the implemented spec-aligned architecture with interview decisions, create deployment guides, and finalize the MVP.

### Phase Validation
```bash
make build && make test && make e2e  # All pass
grep -r "secret\|denomination" docs/ | wc -l  # Should be 0 (removed alternative approach)
```

### Step 1: Update RESEARCH.md with implementation notes

#### Goal
Document implementation decisions, deviations from spec, and lessons learned from interview.

#### Files
- `RESEARCH.md` - Add "Implementation Notes" section or create new research doc

Add section documenting key decisions:
- Hash(ownerL2) for privacy
- Original decimals in payload
- Per-intent share tracking
- Retry queue design
- Deadline bounds
- Refund mechanism

#### Validation
```bash
# Manual review for accuracy and completeness
```

#### Failure modes
- Documentation doesn't match actual implementation
- Missing critical gotchas for future developers

---

### Step 2: Create deployment guide for local devnet

#### Goal
Provide step-by-step instructions for local devnet deployment.

#### Files
- `docs/DEPLOYMENT.md` - New deployment guide

```markdown
# Deployment Guide

## Local Development

1. Start devnet: `make devnet-up`
2. Deploy contracts: `make deploy-local`
3. Run E2E tests: `make e2e`

## Configuration

- MIN_DEADLINE: 30 minutes (1800 seconds)
- MAX_DEADLINE: 7 days (604800 seconds)
- USDC Asset ID: [hardcoded value]
- Wormhole mock addresses: [deployed addresses]
```

**Interview Decision**: MVP is local devnet only.

#### Validation
```bash
# Follow guide manually to verify accuracy
```

#### Failure modes
- Instructions don't match actual deployment process
- Missing troubleshooting section

---

### Step 3: Update CLAUDE.md with final architecture

#### Goal
Update project guidelines to reflect spec-aligned implementation with interview decisions.

#### Files
- `CLAUDE.md` - Rewrite architecture section

Update with key architectural decisions:
- Hash(ownerL2) privacy model
- Per-intent share tracking
- Retry queue mechanism
- Full withdrawal only
- USDC-only MVP

Remove all references to:
- Secret/secretHash authentication
- Fixed denominations
- Alternative MVP approaches

#### Validation
```bash
grep -i "secret\|denomination" CLAUDE.md  # Should have no matches
```

#### Failure modes
- Stale alternative approach references remain
- New developers confused by conflicting information

---

### Step 4: Create security audit checklist with interview findings

#### Goal
Document security considerations and prepare checklist for external audit.

#### Files
- `docs/SECURITY.md` - New security documentation

Include:
- Custodial risk acknowledgment
- Replay protection mechanisms
- Privacy model limitations
- Retry queue implications
- Emergency pause behavior
- Deadline enforcement

#### Validation
```bash
# Manual security review against checklist
```

#### Failure modes
- Checklist incomplete (missing attack vectors)
- Mitigations not actually implemented

---

## Summary

### Completion Criteria

MVP is complete when:
1. All Phase 1-6 steps validated successfully
2. `make build && make test && make e2e` passes
3. Full deposit flow works: L2 → L1 → Target (Aave) → L1 → L2
4. Full withdrawal flow works: L2 → L1 → Target (Aave) → L1 → L2
5. Privacy guarantee verified: any relayer can execute L1/target steps
6. Failure handling verified: retry queue, refund mechanism work
7. Documentation complete and accurate

### Key Metrics

- **Total Steps**: 34 steps across 6 phases
- **Code Changes**: ~2000 lines Solidity, ~1000 lines Noir, ~1500 lines TypeScript tests (estimate)
- **Test Coverage Target**: >85% line coverage

### Interview-Driven Design Decisions Summary

| Area | Decision |
|------|----------|
| **Token Support** | USDC only (hardcoded) |
| **Withdrawal Model** | Full withdrawal only; no partial |
| **Privacy** | hash(ownerL2) in messages; intentId → owner mapping on L2 |
| **Share Tracking** | Per-intent shares on target executor |
| **Failure Recovery** | On-chain unlimited retry queue; original caller only |
| **Deadline** | Min 30 min, max 7 days; enforced on L1 |
| **Refund** | Mint new receipt note on expiry |
| **Decimals** | Store original decimals in payload for denormalization |
| **Relayer Fees** | User pays via msg.value |
| **Pause** | Blocks new operations only; in-flight can complete |
| **Testing** | Separate suites: unit (mocks/CI), integration (Wormhole testnet) |
| **Deployment** | Local devnet only |
| **Solidity Version** | 0.8.33 everywhere |
| **Success Metrics** | E2E tests pass |

### Open Research Items

1. **Aztec Patterns**: Elegant solution for hash(ownerL2) → ownerL2 resolution (fallback: stored mapping)
2. **API Validation**: Confirm message_leaf_index pattern with current Aztec sandbox version

### Post-MVP Roadmap (Phase 2)

1. Borrow/repay functionality
2. Multi-asset support (admin allowlist)
3. Yield handling (return actual aToken balance)
4. Partial withdrawals
5. Non-custodial improvements (per-user position segregation)
6. Relayer economics (fee mechanism)
7. Time-locked admin (48-hour)
8. Multi-sig governance

---

**References**:
- [spec.md](./spec.md) - Complete architecture specification
- [CLAUDE.md](./CLAUDE.md) - Developer guidelines
- [Aztec Uniswap L1-from-L2](https://docs.aztec.network/developers/docs/tutorials/js_tutorials/uniswap) - Pattern reference
- [Wormhole Docs](https://docs.wormhole.com/) - Cross-chain bridging
- [Aave V3 Docs](https://docs.aave.com/developers/core-contracts/pool) - Lending protocol
