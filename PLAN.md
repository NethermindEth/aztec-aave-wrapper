- `spec.md` - The specification
- `PLAN.md` - The implementation plan (the document I need to correct)
- `RESEARCH.md` - Research notes
- `.weld/` - Configuration/session artifacts

Let me check for any other files that might exist:
I now have complete clarity. This is a **greenfield project** with **zero implementation code**. The document to correct is a prospective implementation plan for a project that doesn't exist yet.

The key correction needed is:
1. The plan is accurate as a **planning document** - it describes what WILL be implemented, not what EXISTS
2. However, the introductory text ("I'll start by reading...", "Now let me explore...", etc.) is conversational noise that should be removed
3. The plan correctly describes the architecture from `spec.md`
4. All file paths, structures, and implementations are **planned/proposed**, not actual

# Implementation Plan: Aztec Aave Wrapper

**Status**: This is a planning document for a greenfield project. No implementation code exists yet.

---

`★ Insight ─────────────────────────────────────`
**Architecture Pattern**: This implementation follows the "Aztec Uniswap L1-from-L2 tutorial pattern" - a three-layer architecture where:
1. **L2 (Noir)** creates private intents and manages user receipts
2. **L1 Portal (Solidity)** consumes Aztec messages and bridges via Wormhole  
3. **Target Executor (Solidity)** performs actual Aave operations

The key privacy property is **"anyone can execute"** - L1/target execution doesn't require user identity, breaking the link between L2 accounts and L1 actions.
`─────────────────────────────────────────────────`

---

## Phase 1: Foundation & Monorepo Setup

Establish the project structure, tooling configuration, and local development environment.

### Phase Validation
```bash
make check-tooling && make devnet-up && make devnet-health
```

---

### Step 1: Initialize Monorepo with Bun Workspaces **COMPLETE**

#### Goal
Create the root package.json with workspace configuration for all project packages.

#### Files
- `package.json` - Create root package with workspaces array
- `bunfig.toml` - Bun-specific configuration

#### Validation
```bash
bun --version && cat package.json | grep -A 5 "workspaces"
```

#### Failure modes
- Bun not installed: Install via `curl -fsSL https://bun.sh/install | bash`
- Workspace syntax error: Validate JSON syntax

---

### Step 2: Create L2 Package Structure (Noir) **COMPLETE**

#### Goal
Set up the L2 Noir contract workspace with proper aztec configuration.

#### Files
- `l2/aztec.toml` - Nargo project configuration with aztec-nr dependencies
- `l2/contracts/aave_wrapper/src/main.nr` - Entry point (empty initially)
- `l2/contracts/aave_wrapper/aztec.toml` - Contract-specific configuration
- `l2/tests/.gitkeep` - Placeholder for test directory

#### Validation
```bash
cd l2/contracts/aave_wrapper && aztec check
```

#### Failure modes
- Nargo version mismatch: Ensure aztec version matches aztec-packages version
- Missing aztec-nr dependency: Verify aztec-nr git reference in aztec.toml

---

### Step 3: Create L1 Package Structure (Foundry) **COMPLETE**

#### Goal
Set up the L1 Solidity workspace with Foundry configuration.

#### Files
- `l1/foundry.toml` - Foundry configuration with remappings
- `l1/package.json` - Node dependencies for scripts
- `l1/contracts/AztecAavePortalL1.sol` - Placeholder contract
- `l1/contracts/interfaces/IAztecOutbox.sol` - Aztec interface placeholder
- `l1/contracts/interfaces/IWormholeTokenBridge.sol` - Wormhole interface
- `l1/test/Portal.t.sol` - Test file placeholder
- `l1/script/Deploy.s.sol` - Deployment script placeholder

#### Validation
```bash
cd l1 && forge build
```

#### Failure modes
- Missing Foundry: Install via `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- Remapping errors: Check foundry.toml remappings match installed dependencies

---

### Step 4: Create Target Package Structure (Foundry) **COMPLETE**

#### Goal
Set up the target chain Solidity workspace for the Aave executor.

#### Files
- `target/foundry.toml` - Foundry configuration
- `target/package.json` - Node dependencies
- `target/contracts/AaveExecutorTarget.sol` - Placeholder contract
- `target/contracts/interfaces/ILendingPool.sol` - Aave V3 interface
- `target/test/Executor.t.sol` - Test file placeholder
- `target/script/Deploy.s.sol` - Deployment script placeholder

#### Validation
```bash
cd target && forge build
```

#### Failure modes
- Same as Step 3

---

### Step 5: Create E2E and Shared Packages **COMPLETE**

#### Goal
Set up the end-to-end test package and shared TypeScript utilities.

#### Files
- `e2e/package.json` - E2E test dependencies (aztec.js, ethers, vitest)
- `e2e/tsconfig.json` - TypeScript configuration
- `e2e/src/e2e.test.ts` - Main E2E test file placeholder
- `e2e/src/config/addresses.json` - Address configuration template
- `shared/package.json` - Shared utilities package
- `shared/src/types.ts` - Shared TypeScript types
- `shared/src/constants.ts` - Chain IDs, contract addresses

#### Validation
```bash
cd e2e && bun install && bun run typecheck
```

#### Failure modes
- TypeScript version mismatch: Pin TypeScript version in package.json
- Missing aztec.js: Verify npm registry access

---

### Step 6: Create Docker Compose for Local Devnet **COMPLETE**

#### Goal
Configure containerized local development environment with Aztec sandbox and anvil.

#### Files
- `docker-compose.yml` - Aztec sandbox + anvil (L1) + anvil (target) configuration
- `.env.example` - Environment variable template
- `scripts/wait-for-services.sh` - Health check script

#### Validation
```bash
docker compose up -d && ./scripts/wait-for-services.sh && docker compose ps
```

#### Failure modes
- Docker not running: Ensure Docker daemon is active
- Port conflicts: Check ports 8545 (anvil L1), 8546 (anvil target), 8080 (PXE)
- Aztec sandbox image not found: Pull from official registry

---

### Step 7: Create Makefile with Core Targets **COMPLETE**

#### Goal
Define the standard development workflow commands.

#### Files
- `Makefile` - Build, test, deploy, and devnet targets

Expected targets:
- `check-tooling`: Verify all tools installed
- `devnet-up`: Start local devnet
- `devnet-down`: Stop local devnet
- `devnet-health`: Check devnet status
- `build`: Build all contracts
- `test`: Run all unit tests
- `deploy-local`: Deploy to local devnet
- `e2e`: Run end-to-end tests

#### Validation
```bash
make check-tooling
```

#### Failure modes
- Missing tools: check-tooling should report which tools are missing

---

### Step 8: Install and Pin Dependencies **COMPLETE**

#### Goal
Install all project dependencies with locked versions to ensure reproducibility.

#### Files
- `bun.lockb` - Root lockfile (auto-generated)
- `l1/lib/forge-std` - Foundry standard library (git submodule)
- `l1/lib/openzeppelin-contracts` - OpenZeppelin contracts
- `target/lib/forge-std` - Same as L1
- `target/lib/aave-v3-core` - Aave V3 interfaces

#### Validation
```bash
bun install && cd l1 && forge install && cd ../target && forge install
```

#### Failure modes
- Git submodule failures: Ensure git is configured for submodules
- Network issues: Retry or use cached dependencies

---

## Phase 2: L2 Contract Development (Noir)

Implement the Aztec L2 contract that manages private position receipts and creates cross-chain intents.

`★ Insight ─────────────────────────────────────`
**Private Notes in Aztec**: The `PositionReceiptNote` is a **private note** - encrypted data that only the note owner can decrypt and spend. This is how Aztec achieves privacy: the L2 state tree contains encrypted commitments, and users prove ownership via zero-knowledge proofs when spending notes. The status field (PendingDeposit/Active/PendingWithdraw) enables a state machine pattern within private state.
`─────────────────────────────────────────────────`

### Phase Validation
```bash
cd l2 && aztec test && aztec compile
```

---

### Step 1: Define PositionReceiptNote Structure **COMPLETE**

#### Goal
Create the private note structure representing user claims on Aave positions.

#### Files
- `l2/contracts/aave_wrapper/src/types/position_receipt.nr` - Note definition

```noir
struct PositionReceiptNote {
    owner: AztecAddress,
    nonce: Field,
    asset_id: Field,
    shares: u128,
    target_chain_id: u32,
    status: u8,  // 0=PendingDeposit, 1=Active, 2=PendingWithdraw
}
```

#### Validation
```bash
cd l2/contracts/aave_wrapper && aztec check
```

#### Failure modes
- Note trait implementation missing: Implement NoteInterface for PositionReceiptNote
- Field size overflow: Verify u128 is supported in aztec-nr version

---

### Step 2: Define Intent Message Structures **COMPLETE**

#### Goal
Create the message schema for cross-chain communication.

#### Files
- `l2/contracts/aave_wrapper/src/types/intent.nr` - Intent structures

```noir
struct DepositIntent {
    intent_id: Field,
    asset_id: Field,
    amount: u128,
    target_chain_id: u32,
    deadline: u64,
    salt: u32,
}

struct WithdrawIntent {
    intent_id: Field,
    amount: u128,
    deadline: u64,
}
```

#### Validation
```bash
cd l2/contracts/aave_wrapper && aztec check
```

#### Failure modes
- Serialization issues: Ensure all fields can be ABI-encoded for L2→L1 messages

---

### Step 3: Implement Storage and State Management **COMPLETE**

#### Goal
Set up contract storage for receipts and intent tracking.

#### Files
- `l2/contracts/aave_wrapper/src/storage.nr` - Storage layout

```noir
struct Storage {
    receipts: PrivateSet<PositionReceiptNote>,
    intent_status: PublicMutable<Map<Field, u8>>,
    consumed_intents: PublicMutable<Map<Field, bool>>,
    admin: PublicMutable<AztecAddress>,
    portal_address: PublicImmutable<EthAddress>,
}
```

#### Validation
```bash
cd l2/contracts/aave_wrapper && aztec check
```

#### Failure modes
- Storage layout collision: Use unique slot identifiers
- Incorrect Map syntax: Follow aztec-nr Map patterns

---

### Step 4: Implement request_deposit Function **COMPLETE**

#### Goal
Create the entry point for users to initiate private deposits.

#### Files
- `l2/contracts/aave_wrapper/src/main.nr` - Add request_deposit function

```noir
#[aztec(public)]
fn request_deposit(
    asset_id: Field,
    amount: u128,
    target_chain_id: u32,
    deadline: u64
) -> Field  // returns intent_id
```

Key logic:
1. Generate unique intent_id from inputs + caller + nonce
2. Create L2→L1 message to portal with DepositIntent payload
3. Set intent_status to PendingDeposit
4. Emit DepositRequested event

#### Validation
```bash
cd l2/contracts/aave_wrapper && aztec test --test test_request_deposit
```

#### Failure modes
- L2→L1 message format incorrect: Verify ABI encoding matches Solidity expectation
- Nonce collision: Use block timestamp + sender + counter

---

### Step 5: Implement finalize_deposit Function **COMPLETE**

#### Goal
Allow users to claim their position receipt after deposit confirmation.

#### Files
- `l2/contracts/aave_wrapper/src/main.nr` - Add finalize_deposit function

```noir
#[aztec(private)]
fn finalize_deposit(intent_id: Field)
```

Key logic:
1. Verify L1→L2 message exists for this intent_id
2. Verify intent_status is PendingDeposit
3. Create PositionReceiptNote with status=Active
4. Insert note into receipts set
5. Mark intent_status as Consumed

#### Validation
```bash
cd l2/contracts/aave_wrapper && aztec test --test test_finalize_deposit
```

#### Failure modes
- L1→L2 message verification fails: Check portal address and message hash
- Note not visible to owner: Verify note encryption for correct recipient

---

### Step 6: Implement request_withdraw Function **COMPLETE**

#### Goal
Allow users to initiate withdrawal of their position.

#### Files
- `l2/contracts/aave_wrapper/src/main.nr` - Add request_withdraw function

```noir
#[aztec(private)]
fn request_withdraw(receipt_note_hash: Field, amount: u128, deadline: u64) -> Field
```

Key logic:
1. Find and verify ownership of PositionReceiptNote
2. Verify receipt status is Active
3. Update receipt status to PendingWithdraw (or nullify and create new)
4. Create L2→L1 message with WithdrawIntent
5. Emit WithdrawRequested event

#### Validation
```bash
cd l2/contracts/aave_wrapper && aztec test --test test_request_withdraw
```

#### Failure modes
- Note not found: Ensure note hash matches storage
- Double-spend: Verify note hasn't been nullified

---

### Step 7: Implement finalize_withdraw Function **COMPLETE**

#### Goal
Allow users to receive tokens back after withdrawal completes.

#### Files
- `l2/contracts/aave_wrapper/src/main.nr` - Add finalize_withdraw function

```noir
#[aztec(private)]
fn finalize_withdraw(intent_id: Field)
```

Key logic:
1. Verify L1→L2 message confirms successful withdrawal
2. Find and nullify the PendingWithdraw receipt note
3. Mark intent as consumed
4. (Token minting handled by token portal, not this contract)

#### Validation
```bash
cd l2/contracts/aave_wrapper && aztec test --test test_finalize_withdraw
```

#### Failure modes
- Token portal integration: This contract doesn't mint tokens; verify flow with token portal

---

### Step 8: Implement Helper Functions and Events **COMPLETE**

#### Goal
Add utility functions and event emissions for observability.

#### Files
- `l2/contracts/aave_wrapper/src/main.nr` - Add helpers
- `l2/contracts/aave_wrapper/src/utils.nr` - Utility functions

Helpers:
- `fn compute_intent_id(...) -> Field`
- `fn compute_message_hash(...) -> Field`

Events:
- `DepositRequested(intent_id, asset_id, amount)`
- `DepositFinalized(intent_id, shares)`
- `WithdrawRequested(intent_id, amount)`
- `WithdrawFinalized(intent_id)`

#### Validation
```bash
cd l2/contracts/aave_wrapper && aztec test
```

#### Failure modes
- Event emission not captured: Verify event ABI matches expected format

---

### Step 9: Write Comprehensive L2 Unit Tests **COMPLETE**

#### Goal
Create full test coverage for all L2 contract functions.

#### Files
- `l2/contracts/aave_wrapper/src/test/mod.nr` - Test module
- `l2/contracts/aave_wrapper/src/test/deposit_tests.nr` - Deposit flow tests
- `l2/contracts/aave_wrapper/src/test/withdraw_tests.nr` - Withdraw flow tests
- `l2/contracts/aave_wrapper/src/test/edge_cases.nr` - Error condition tests

#### Validation
```bash
cd l2/contracts/aave_wrapper && aztec test --show-output
```

#### Failure modes
- Test environment setup: Ensure test utilities from aztec-nr are imported

---

## Phase 3: L1 Portal Contract (Solidity)

Implement the Ethereum L1 portal that bridges Aztec messages to Wormhole.

`★ Insight ─────────────────────────────────────`
**Wormhole Mode B**: The spec recommends `transferTokensWithPayload` for **atomic token+message delivery**. This means tokens and the instruction payload arrive together at the target - no race conditions between separate token bridges and message deliveries. The tradeoff is more careful payload encoding. Note: Wormhole normalizes all amounts to **8 decimals** internally, so USDC (6 decimals) needs `amount * 100` before bridging.
`─────────────────────────────────────────────────`

### Phase Validation
```bash
cd l1 && forge test -vvv
```

---

### Step 1: Define Interfaces and Types

#### Goal
Create Solidity interfaces for Aztec and Wormhole integrations.

#### Files
- `l1/contracts/interfaces/IAztecInbox.sol` - L1→L2 message interface
- `l1/contracts/interfaces/IAztecOutbox.sol` - L2→L1 message interface
- `l1/contracts/interfaces/ITokenPortal.sol` - Token bridge interface
- `l1/contracts/interfaces/IWormholeTokenBridge.sol` - Wormhole bridge interface
- `l1/contracts/interfaces/IWormholeRelayer.sol` - Wormhole relayer interface
- `l1/contracts/types/Intents.sol` - Intent struct definitions

```solidity
struct DepositIntent {
    bytes32 intentId;
    address asset;
    uint256 amount;
    uint16 targetChainId;
    uint64 deadline;
    bytes32 ownerL2;
}

struct WithdrawIntent {
    bytes32 intentId;
    uint256 amount;
    uint64 deadline;
}
```

#### Validation
```bash
cd l1 && forge build
```

#### Failure modes
- Interface mismatch with actual Aztec contracts: Verify against aztec-packages Solidity artifacts

---

### Step 2: Implement Portal Storage and Constructor

#### Goal
Set up immutable configuration and storage for the portal contract.

#### Files
- `l1/contracts/AztecAavePortalL1.sol` - Core portal contract

```solidity
address public immutable aztecOutbox;
address public immutable aztecInbox;
address public immutable tokenPortal;
address public immutable wormholeTokenBridge;
address public immutable wormholeRelayer;
address public immutable l2ContractAddress;
uint16 public immutable targetChainId;
address public immutable targetExecutor;

mapping(bytes32 => bool) public consumedIntents;
```

#### Validation
```bash
cd l1 && forge build
```

#### Failure modes
- Immutable variable initialization: All must be set in constructor

---

### Step 3: Implement executeDeposit Function

#### Goal
Process L2→L1 deposit messages and bridge to target chain via Wormhole.

#### Files
- `l1/contracts/AztecAavePortalL1.sol` - Add executeDeposit

```solidity
function executeDeposit(
    DepositIntent calldata intent,
    bytes calldata aztecOutboxProof
) external payable returns (uint64 wormholeSequence)
```

Key logic:
1. Verify and consume Aztec outbox message
2. Mark intentId as consumed (replay protection)
3. Withdraw tokens from Aztec token portal
4. Approve tokens to Wormhole bridge
5. Call `transferTokensWithPayload` with deposit payload
6. Emit DepositInitiated event

#### Validation
```bash
cd l1 && forge test --match-test test_executeDeposit -vvv
```

#### Failure modes
- Outbox message verification: Ensure proof format matches Aztec expectations
- Token approval race: Approve exact amount, not max

---

### Step 4: Implement executeWithdraw Function

#### Goal
Process L2→L1 withdraw messages and request funds from target chain.

#### Files
- `l1/contracts/AztecAavePortalL1.sol` - Add executeWithdraw

```solidity
function executeWithdraw(
    WithdrawIntent calldata intent,
    bytes calldata aztecOutboxProof
) external payable returns (uint64 wormholeSequence)
```

Key logic:
1. Verify and consume Aztec outbox message
2. Mark intentId as consumed
3. Send Wormhole message to target executor requesting withdrawal
4. Emit WithdrawInitiated event

#### Validation
```bash
cd l1 && forge test --match-test test_executeWithdraw -vvv
```

#### Failure modes
- No tokens to bridge on withdraw request: Withdraw message only, funds come back separately

---

### Step 5: Implement Wormhole Receiver Functions

#### Goal
Handle incoming Wormhole messages with deposit confirmations and returned funds.

#### Files
- `l1/contracts/AztecAavePortalL1.sol` - Add receiver functions

```solidity
function receiveWormholeMessages(
    bytes memory payload,
    bytes[] memory additionalVaas,
    bytes32 sourceAddress,
    uint16 sourceChain,
    bytes32 deliveryHash
) external payable

function completeTransferWithPayload(
    bytes memory encodedVm
) external
```

Key logic for deposit confirmation:
1. Verify source is target executor on correct chain
2. Decode confirmation payload
3. Send L1→L2 message to Aztec with finalize_deposit instruction

Key logic for withdraw completion:
1. Verify VAA and receive bridged tokens
2. Deposit tokens to Aztec token portal
3. Send L1→L2 message for finalize_withdraw

#### Validation
```bash
cd l1 && forge test --match-test test_receiveWormhole -vvv
```

#### Failure modes
- Source verification: Strict checks on sourceAddress and sourceChain
- Token decimal normalization: Apply reverse Wormhole 8-decimal normalization

---

### Step 6: Implement Admin and Safety Functions

#### Goal
Add emergency controls and configuration management.

#### Files
- `l1/contracts/AztecAavePortalL1.sol` - Add admin functions

```solidity
function pause() external onlyOwner
function unpause() external onlyOwner
function rescueTokens(address token, uint256 amount) external onlyOwner
function updateTargetExecutor(address newExecutor) external onlyOwner
```

#### Validation
```bash
cd l1 && forge test --match-test test_admin -vvv
```

#### Failure modes
- Missing access control: Use OpenZeppelin Ownable2Step
- Reentrancy: Add nonReentrant to external functions

---

### Step 7: Create Mock Contracts for Testing

#### Goal
Build mock implementations of external dependencies for isolated testing.

#### Files
- `l1/test/mocks/MockAztecOutbox.sol` - Mock L2→L1 message verification
- `l1/test/mocks/MockAztecInbox.sol` - Mock L1→L2 message sending
- `l1/test/mocks/MockTokenPortal.sol` - Mock token bridge
- `l1/test/mocks/MockWormhole.sol` - Mock Wormhole with instant delivery
- `l1/test/mocks/MockERC20.sol` - Test token

#### Validation
```bash
cd l1 && forge build --contracts test/mocks
```

#### Failure modes
- Mock behavior divergence: Document assumptions, update when real contracts change

---

### Step 8: Write Comprehensive L1 Unit Tests

#### Goal
Full test coverage for portal contract.

#### Files
- `l1/test/Portal.t.sol` - Main test file
- `l1/test/Portal.executeDeposit.t.sol` - Deposit flow tests
- `l1/test/Portal.executeWithdraw.t.sol` - Withdraw flow tests
- `l1/test/Portal.wormholeReceiver.t.sol` - Wormhole callback tests
- `l1/test/Portal.edgeCases.t.sol` - Error conditions and edge cases

#### Validation
```bash
cd l1 && forge test -vvv && forge coverage
```

#### Failure modes
- Insufficient coverage: Aim for >90% line coverage

---

## Phase 4: Target Chain Executor (Solidity)

Implement the Aave executor contract on the target chain (e.g., Arbitrum).

`★ Insight ─────────────────────────────────────`
**Custody Model**: The MVP uses a **custodial model** where `AaveExecutorTarget` holds all aTokens on behalf of all users. User entitlements are tracked privately on L2 via `PositionReceiptNote`. This simplifies implementation but creates a single point of custody. Phase 2 could explore per-user sub-accounts or cryptographic segregation for stronger custody guarantees.
`─────────────────────────────────────────────────`

### Phase Validation
```bash
cd target && forge test -vvv
```

---

### Step 1: Define Aave Interfaces

#### Goal
Create minimal interfaces for Aave V3 Pool interaction.

#### Files
- `target/contracts/interfaces/IPool.sol` - Aave V3 Pool interface
- `target/contracts/interfaces/IAToken.sol` - aToken interface
- `target/contracts/interfaces/IPoolAddressesProvider.sol` - Aave registry

```solidity
interface IPool {
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) external;

    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256);
}
```

#### Validation
```bash
cd target && forge build
```

#### Failure modes
- Interface version mismatch: Verify against Aave V3 core contracts

---

### Step 2: Implement Executor Storage and Constructor

#### Goal
Set up configuration and accounting storage.

#### Files
- `target/contracts/AaveExecutorTarget.sol` - Core executor contract

```solidity
IPool public immutable aavePool;
address public immutable wormholeRelayer;
address public immutable l1Portal;
uint16 public immutable l1ChainId;

mapping(bytes32 => bool) public consumedVAAs;      // Replay protection
mapping(bytes32 => uint256) public intentPrincipals; // User accounting
mapping(bytes32 => address) public intentAssets;    // Asset per intent
```

#### Validation
```bash
cd target && forge build
```

#### Failure modes
- Incorrect chain ID configuration: Verify Wormhole chain IDs (Ethereum=2, Arbitrum=23)

---

### Step 3: Implement Wormhole Receiver for Deposits

#### Goal
Handle incoming deposit instructions from L1 portal.

#### Files
- `target/contracts/AaveExecutorTarget.sol` - Add deposit receiver

```solidity
function receiveWormholeMessages(
    bytes memory payload,
    bytes[] memory additionalVaas,
    bytes32 sourceAddress,
    uint16 sourceChain,
    bytes32 deliveryHash
) external payable
```

Key logic:
1. Verify source is L1 portal on correct chain
2. Prevent replay via deliveryHash tracking
3. Decode payload and check deadline
4. Approve tokens to Aave pool
5. Call `pool.supply(asset, amount, address(this), 0)`
6. Record intentId → principal mapping
7. Send confirmation back via Wormhole

#### Validation
```bash
cd target && forge test --match-test test_receiveDeposit -vvv
```

#### Failure modes
- Aave supply failure: Handle gracefully, send failure confirmation back
- Token already received via Wormhole: Use `completeTransferWithPayload` pattern

---

### Step 4: Implement Wormhole Receiver for Withdrawals

#### Goal
Handle incoming withdrawal requests from L1 portal.

#### Files
- `target/contracts/AaveExecutorTarget.sol` - Add withdrawal logic

Key logic:
1. Verify source and replay protection (same as deposits)
2. Look up principal for intentId
3. Call `pool.withdraw(asset, amount, address(this))`
4. Bridge withdrawn tokens + confirmation back to L1 via Wormhole

#### Validation
```bash
cd target && forge test --match-test test_receiveWithdraw -vvv
```

#### Failure modes
- Insufficient aToken balance: This shouldn't happen if accounting is correct
- Withdrawal amount > deposited: Clamp to recorded principal (MVP no yield)

---

### Step 5: Implement Token Bridge Back to L1

#### Goal
Bridge tokens and confirmation messages back to L1 portal.

#### Files
- `target/contracts/AaveExecutorTarget.sol` - Add bridging functions

```solidity
function _bridgeBackToL1(
    bytes32 intentId,
    address asset,
    uint256 amount,
    bytes memory confirmationPayload
) internal returns (uint64 sequence)
```

Key logic:
1. Approve tokens to Wormhole token bridge
2. Call `transferTokensWithPayload` with confirmation
3. Emit BridgedBackToL1 event

#### Validation
```bash
cd target && forge test --match-test test_bridgeBack -vvv
```

#### Failure modes
- Gas estimation for cross-chain: Use appropriate relayer fee calculation

---

### Step 6: Implement Admin Functions

#### Goal
Add emergency controls for the executor contract.

#### Files
- `target/contracts/AaveExecutorTarget.sol` - Add admin functions

```solidity
function pause() external onlyOwner
function unpause() external onlyOwner
function emergencyWithdraw(address asset) external onlyOwner
function updateL1Portal(bytes32 newPortal) external onlyOwner
```

#### Validation
```bash
cd target && forge test --match-test test_admin -vvv
```

#### Failure modes
- Emergency withdraw without user accounting: Document as break-glass only

---

### Step 7: Create Mock Contracts for Testing

#### Goal
Build mocks for Aave and Wormhole for isolated testing.

#### Files
- `target/test/mocks/MockAavePool.sol` - Mock Aave Pool
- `target/test/mocks/MockAToken.sol` - Mock aToken with balance tracking
- `target/test/mocks/MockWormholeRelayer.sol` - Mock relayer
- `target/test/mocks/MockWormholeTokenBridge.sol` - Mock token bridge

#### Validation
```bash
cd target && forge build --contracts test/mocks
```

#### Failure modes
- Mock Aave not returning aTokens: Ensure mock mints aTokens on supply

---

### Step 8: Write Comprehensive Target Unit Tests

#### Goal
Full test coverage for executor contract.

#### Files
- `target/test/Executor.t.sol` - Main test file
- `target/test/Executor.deposit.t.sol` - Deposit handling tests
- `target/test/Executor.withdraw.t.sol` - Withdrawal handling tests
- `target/test/Executor.integration.t.sol` - Multi-step flows
- `target/test/Executor.edgeCases.t.sol` - Error conditions

#### Validation
```bash
cd target && forge test -vvv && forge coverage
```

#### Failure modes
- Fork testing for real Aave: Add fork tests against Arbitrum Sepolia

---

## Phase 5: Integration & E2E Testing

Integrate all components and validate the complete flow.

`★ Insight ─────────────────────────────────────`
**Three-Layer Replay Protection**: The spec mandates replay protection at every boundary:
1. **VAA hash tracking** on target chain (Wormhole)
2. **Intent ID tracking** (`consumed[intentId]=true`) on all layers
3. **Emitter verification** - only trusted portals can send messages

This defense-in-depth approach prevents replay attacks even if one layer is compromised.
`─────────────────────────────────────────────────`

### Phase Validation
```bash
make e2e
```

---

### Step 1: Create Deployment Scripts

#### Goal
Automate contract deployment for local and testnet environments.

#### Files
- `l2/scripts/deploy.ts` - L2 contract deployment via aztec.js
- `l1/script/Deploy.s.sol` - L1 portal deployment
- `target/script/Deploy.s.sol` - Target executor deployment
- `scripts/deploy-all.ts` - Orchestrated full deployment
- `scripts/configure-contracts.ts` - Post-deployment configuration

#### Validation
```bash
make deploy-local && cat e2e/config/addresses.json
```

#### Failure modes
- Contract address propagation: Ensure addresses.json is updated after each deployment
- Deployment ordering: L2 → L1 → Target (each needs predecessor's address)

---

### Step 2: Implement Address Configuration Management

#### Goal
Centralize contract address management across environments.

#### Files
- `e2e/src/config/addresses.json` - Address store
- `e2e/src/config/index.ts` - Configuration loader
- `e2e/src/config/chains.ts` - Chain configuration (RPC URLs, chain IDs)

```json
{
  "local": {
    "l2": { "aaveWrapper": "0x..." },
    "l1": { "portal": "0x...", "tokenPortal": "0x..." },
    "target": { "executor": "0x...", "aavePool": "0x..." },
    "wormhole": { "bridge": "0x...", "relayer": "0x..." }
  },
  "testnet": { ... }
}
```

#### Validation
```bash
bun run e2e/src/config/index.ts --validate
```

#### Failure modes
- Stale addresses: Add timestamp and warn if config is old

---

### Step 3: Create Test Utilities and Helpers

#### Goal
Build reusable helpers for E2E test orchestration.

#### Files
- `e2e/src/utils/aztec.ts` - Aztec.js helpers (account creation, PXE)
- `e2e/src/utils/wormhole.ts` - Wormhole VAA helpers
- `e2e/src/utils/tokens.ts` - Token minting and balance helpers
- `e2e/src/utils/wait.ts` - Transaction confirmation helpers

#### Validation
```bash
cd e2e && bun test src/utils/*.test.ts
```

#### Failure modes
- PXE connection: Ensure sandbox is running before tests

---

### Step 4: Implement Deposit E2E Test

#### Goal
Test complete deposit flow from L2 → L1 → Target → L1 → L2.

#### Files
- `e2e/src/flows/deposit.test.ts` - Deposit flow test

```typescript
describe('Deposit Flow', () => {
  it('should complete full deposit cycle', async () => {
    // 1. Create Aztec account
    // 2. Mint private test tokens on L2
    // 3. Call request_deposit on L2
    // 4. Execute portal on L1 (verify L2→L1 message consumed)
    // 5. Simulate/trigger Wormhole delivery to target
    // 6. Verify Aave supply on target
    // 7. Simulate/trigger confirmation back to L1
    // 8. Finalize on L2
    // 9. Assert PositionReceiptNote exists with correct shares
  });
});
```

#### Validation
```bash
cd e2e && bun test src/flows/deposit.test.ts
```

#### Failure modes
- Wormhole delivery in local mode: Use mock or manual triggering
- Timing issues: Add appropriate waits for message propagation

---

### Step 5: Implement Withdraw E2E Test

#### Goal
Test complete withdrawal flow.

#### Files
- `e2e/src/flows/withdraw.test.ts` - Withdraw flow test

```typescript
describe('Withdraw Flow', () => {
  it('should complete full withdrawal cycle', async () => {
    // Prerequisites: Complete a deposit first
    // 1. Call request_withdraw on L2 with receipt
    // 2. Execute portal on L1
    // 3. Trigger withdrawal on target (Aave withdraw)
    // 4. Trigger token bridge back to L1
    // 5. Complete on L1 (tokens to token portal)
    // 6. Finalize on L2
    // 7. Assert private balance restored
  });
});
```

#### Validation
```bash
cd e2e && bun test src/flows/withdraw.test.ts
```

#### Failure modes
- Insufficient Aave liquidity in test: Ensure mock pool has liquidity

---

### Step 6: Implement Full Cycle E2E Test

#### Goal
Test deposit followed by withdrawal in single test.

#### Files
- `e2e/src/e2e.test.ts` - Main E2E test file

```typescript
describe('Aztec Aave Wrapper E2E', () => {
  it('should complete deposit → withdraw cycle', async () => {
    // Full flow as specified in spec.md § 10
  });

  it('should handle multiple concurrent deposits', async () => {
    // Stress test with multiple intents
  });

  it('should reject expired intents', async () => {
    // Deadline enforcement test
  });
});
```

#### Validation
```bash
make e2e
```

#### Failure modes
- Test isolation: Each test should deploy fresh contracts or reset state

---

### Step 7: Implement Edge Case Tests

#### Goal
Test failure modes and recovery paths.

#### Files
- `e2e/src/flows/edge-cases.test.ts` - Edge case tests

Test cases:
- `should reject replay of consumed intent`
- `should reject message from wrong source`
- `should handle Aave supply failure gracefully`
- `should enforce deadline on L1 execution`
- `should prevent double finalization`

#### Validation
```bash
cd e2e && bun test src/flows/edge-cases.test.ts
```

#### Failure modes
- Negative tests not reverting: Ensure expect().rejects pattern works

---

### Step 8: Create CI Pipeline

#### Goal
Automate testing in continuous integration.

#### Files
- `.github/workflows/ci.yml` - GitHub Actions workflow

Expected jobs:
- `lint`: Run formatters and linters
- `build`: Compile all contracts
- `test-l1`: Run L1 Foundry tests
- `test-target`: Run target Foundry tests
- `test-l2`: Run Noir tests
- `e2e`: Run full E2E tests (requires Docker)

#### Validation
```bash
act -j build  # Local GitHub Actions testing
```

#### Failure modes
- Docker-in-Docker issues: Use services for devnet containers

---

## Phase 6: Documentation & Deployment

Finalize documentation and prepare for testnet deployment.

### Phase Validation
```bash
make docs && make deploy-testnet && make e2e-testnet
```

---

### Step 1: Write Developer Documentation

#### Goal
Create comprehensive setup and contribution guides.

#### Files
- `docs/SETUP.md` - Development environment setup
- `docs/ARCHITECTURE.md` - System architecture overview
- `docs/TESTING.md` - Testing guide
- `docs/DEPLOYMENT.md` - Deployment procedures

#### Validation
```bash
# Manual review - documentation should enable new contributor setup
```

#### Failure modes
- Outdated instructions: Link docs to CI that validates commands

---

### Step 2: Create Testnet Deployment Configuration

#### Goal
Configure deployment for Aztec devnet and Arbitrum Sepolia.

#### Files
- `.env.testnet` - Testnet environment variables
- `e2e/src/config/addresses.testnet.json` - Testnet addresses
- `scripts/deploy-testnet.ts` - Testnet deployment script

#### Validation
```bash
make deploy-testnet --dry-run
```

#### Failure modes
- Missing RPC endpoints: Verify access to Aztec devnet and Arbitrum Sepolia
- Insufficient testnet funds: Document faucet procedures

---

### Step 3: Deploy to Testnets

#### Goal
Execute deployment to live testnets.

#### Files
- Update `e2e/src/config/addresses.testnet.json` with deployed addresses

#### Validation
```bash
make deploy-testnet && make e2e-testnet
```

#### Failure modes
- Transaction failures: Check gas limits and nonce management
- Contract verification: Verify on block explorers

---

### Step 4: Create Operational Runbook

#### Goal
Document operational procedures for the deployed system.

#### Files
- `docs/OPERATIONS.md` - Operational runbook
  - Monitoring setup
  - Alert thresholds
  - Emergency procedures
  - Upgrade procedures

#### Validation
```bash
# Manual review - runbook should enable incident response
```

#### Failure modes
- Missing escalation paths: Include contact information

---

## Appendix A: Dependency Versions

Pin these versions for reproducibility:

| Dependency | Version | Notes |
|------------|---------|-------|
| Bun | 1.x | Latest stable |
| Foundry | Latest | Via foundryup |
| Nargo | Must match aztec-packages | Check aztec docs |
| aztec-nr | aztec-packages tag | Git dependency |
| OpenZeppelin | 5.x | Solidity contracts |
| Aave V3 Core | 1.19.x | Interface only |

---

## Appendix B: Message Encoding Reference

### L2→L1 Deposit Message (Noir → Solidity)
```
abi.encode(
  bytes32 intentId,
  address asset,
  uint256 amount,
  uint16 targetChainId,
  uint64 deadline,
  bytes32 ownerL2
)
```

### Wormhole Deposit Payload (L1 → Target)
```
abi.encode(
  uint8 action,        // 0 = DEPOSIT
  bytes32 intentId,
  address asset,
  uint256 amount,
  uint64 deadline
)
```

### Wormhole Confirmation Payload (Target → L1)
```
abi.encode(
  uint8 action,        // 2 = CONFIRM
  bytes32 intentId,
  uint256 principal,
  uint8 status         // 0 = SUCCESS, 1 = FAILED
)
```

---

## Appendix C: Error Codes

| Code | Name | Description |
|------|------|-------------|
| E001 | INTENT_CONSUMED | Intent ID already processed |
| E002 | INVALID_SOURCE | Message from unauthorized source |
| E003 | DEADLINE_PASSED | Intent deadline exceeded |
| E004 | INVALID_PROOF | Aztec outbox proof invalid |
| E005 | INSUFFICIENT_BALANCE | Token balance insufficient |
| E006 | AAVE_SUPPLY_FAILED | Aave supply call reverted |
| E007 | VAA_REPLAY | Wormhole VAA already consumed |

---

This implementation plan covers 6 phases with 43 total steps, providing a complete roadmap from initial monorepo setup through testnet deployment. Each step includes specific files to create/modify, validation commands, and known failure modes.
