# Research Findings: Aztec Aave Wrapper README

## Authoritative Files

| File | Owns |
|------|------|
| `CLAUDE.md:1-127` | Project overview, build commands, key files, dependencies |
| `aztec/src/main.nr` | L2 Noir contract (AaveWrapper) |
| `eth/contracts/AztecAavePortalL1.sol` | L1 Portal Solidity contract |
| `target/contracts/AaveExecutorTarget.sol` | Target executor Solidity contract |
| `docker-compose.yml` | Local devnet configuration |
| `Makefile` | All build/test/deploy commands |
| `e2e/src/e2e.test.ts` | E2E test suite |
| `scripts/wait-for-services.sh` | Health check script |

## Key Findings

### What This Repository Does
**Answer:** Privacy-preserving Aave lending from Aztec L2 via Wormhole bridge. Users deposit tokens into Aave V3 on target chains (e.g., Arbitrum) while keeping their identity private on Aztec L2.

**Evidence:**
- `CLAUDE.md:7`: "Aztec Aave Wrapper enables privacy-preserving Aave lending from Aztec L2 via Wormhole bridge"
- `eth/contracts/AztecAavePortalL1.sol:29-36`: Architecture doc comments
- `target/contracts/AaveExecutorTarget.sol:12-26`: Aave V3 integration doc

**Confidence:** High

### Architecture (Three-Layer System)
**Answer:**
1. **L2 (Aztec/Noir)**: Creates private intents, manages encrypted position receipts
2. **L1 Portal (Solidity)**: Consumes Aztec messages, bridges via Wormhole
3. **Target Executor (Solidity)**: Executes Aave operations on destination chain

**Evidence:**
- `CLAUDE.md:9-12`: Architecture overview
- `aztec/src/main.nr:183-963`: Full L2 contract
- `eth/contracts/AztecAavePortalL1.sol:27-43`: L1 portal contract
- `target/contracts/AaveExecutorTarget.sol:12-34`: Target executor

**Confidence:** High

### Privacy Model
**Answer:** Uses `hash(ownerL2)` (Poseidon hash) in cross-chain messages. L1/target execution is done by relayers who don't need to know the L2 owner. Authentication uses secret/secretHash mechanism.

**Evidence:**
- `aztec/src/main.nr:363`: `let owner_hash = poseidon2_hash([caller.to_field()]);`
- `aztec/src/main.nr:49-80`: Privacy documentation in `compute_deposit_message_content`
- `CLAUDE.md:100-104`: Privacy model description

**Confidence:** High

### Build Commands
**Answer:**
```bash
make check-tooling   # Verify tooling
make build           # Build all (L1, L2, Target)
make test            # Run all unit tests
make devnet-up       # Start Docker containers
make devnet-health   # Check services ready
make e2e             # Run E2E tests
```

**Evidence:**
- `Makefile:237-298`: Build and test targets
- `CLAUDE.md:17-51`: Build commands documentation

**Confidence:** High

### Local Development Environment
**Answer:** Docker Compose runs three services:
- `anvil-l1`: Ethereum L1 simulation (port 8545)
- `anvil-target`: Target chain simulation (port 8546)
- `aztec-sandbox`: Aztec PXE (port 8080)

**Evidence:**
- `docker-compose.yml:7-125`: Service definitions
- `CLAUDE.md:79-85`: Environment description

**Confidence:** High

### How to Monitor Logs
**Answer:**
```bash
make devnet-logs     # View all service logs (docker compose logs -f)
docker compose logs anvil-l1 -f    # L1 only
docker compose logs aztec-sandbox -f  # Aztec only
```

**Evidence:**
- `Makefile:217-218`: `devnet-logs` target
- `scripts/wait-for-services.sh:212-215`: Troubleshooting section

**Confidence:** High

### Health Checks
**Answer:** `make devnet-health` runs `scripts/wait-for-services.sh` which:
1. Checks Docker is running
2. Polls each service until healthy (5 minute timeout)
3. Uses JSON-RPC for anvil, `/status` endpoint for PXE

**Evidence:**
- `scripts/wait-for-services.sh:76-119`: Health check functions
- `Makefile:213-214`: Health check target

**Confidence:** High

### Cross-Chain Message Flow
**Answer:**
**Deposit Flow:**
1. L2: `request_deposit()` creates DepositIntent, sends L2→L1 message
2. L1: Portal consumes message, bridges tokens via Wormhole
3. Target: Executor receives tokens, supplies to Aave
4. L1: Portal receives confirmation, sends L1→L2 message
5. L2: `finalize_deposit()` consumes message, creates PositionReceiptNote

**Evidence:**
- `aztec/src/main.nr:342-409`: `request_deposit` implementation
- `eth/contracts/AztecAavePortalL1.sol:203-258`: `executeDeposit` implementation
- `target/contracts/AaveExecutorTarget.sol:159-207`: `consumeAndExecuteDeposit`
- `CLAUDE.md:89-96`: Flow description

**Confidence:** High

### Key Contract Functions

| Contract | Function | Purpose |
|----------|----------|---------|
| L2 (main.nr) | `request_deposit()` | Initiate deposit from L2 |
| L2 (main.nr) | `finalize_deposit()` | Complete deposit, create receipt note |
| L2 (main.nr) | `request_withdraw()` | Initiate withdrawal from L2 |
| L2 (main.nr) | `finalize_withdraw()` | Complete withdrawal, nullify receipt |
| L2 (main.nr) | `claim_refund()` | Refund expired withdrawal requests |
| L1 Portal | `executeDeposit()` | Consume L2 message, bridge via Wormhole |
| L1 Portal | `executeWithdraw()` | Send withdrawal to target via Wormhole |
| L1 Portal | `receiveWormholeMessages()` | Receive confirmations from target |
| L1 Portal | `completeWithdrawalTransfer()` | Complete token bridge back |
| Target | `consumeAndExecuteDeposit()` | Receive tokens, supply to Aave |
| Target | `consumeAndExecuteWithdraw()` | Withdraw from Aave |
| Target | `retryFailedOperation()` | Retry queued failed operations |

**Evidence:** All functions verified in respective source files.

**Confidence:** High

### MVP Constraints
**Answer:**
- **USDC-only**: Single asset support (multi-asset structure exists but not tested)
- **Full withdrawal only**: No partial withdrawals
- **Custodial model**: Target executor holds aTokens; user entitlement via L2 receipts
- **Local devnet only**: Not production-ready

**Evidence:**
- `CLAUDE.md:113-114`: MVP constraints
- `aztec/src/main.nr:614-618`: Full withdrawal enforcement

**Confidence:** High

### Dependencies & Versions
**Answer:**
- **Noir**: aztec-nr from aztec-packages v3.0.0-devnet.20251212
- **Solidity**: 0.8.33 (both L1 and Target)
- **Foundry**: Latest (via foundryup)
- **Bun**: 1.1.0+ (package manager)
- **aztec.js**: ^0.65.0 (E2E tests)
- **Docker**: Required for devnet

**Evidence:**
- `CLAUDE.md:72-76`: Dependencies listed
- `eth/contracts/AztecAavePortalL1.sol:2`: `pragma solidity ^0.8.33`
- `target/contracts/AaveExecutorTarget.sol:2`: `pragma solidity ^0.8.33`

**Confidence:** High

## Actual Flow: Deposit

1. `aztec/src/main.nr:342-409` - User calls `request_deposit()` privately
2. `aztec/src/main.nr:363` - Owner hash computed via Poseidon
3. `aztec/src/main.nr:400` - L2→L1 message sent to portal
4. `eth/contracts/AztecAavePortalL1.sol:203-258` - Relayer calls `executeDeposit()`
5. `eth/contracts/AztecAavePortalL1.sol:228-229` - Aztec outbox message consumed
6. `eth/contracts/AztecAavePortalL1.sol:246-253` - Wormhole bridge called
7. `target/contracts/AaveExecutorTarget.sol:159-207` - Target receives VAA
8. `target/contracts/AaveExecutorTarget.sol:220` - Aave `supply()` called
9. L1 receives confirmation via `receiveWormholeMessages()`
10. `aztec/src/main.nr:462-514` - User calls `finalize_deposit()`
11. `aztec/src/main.nr:495-507` - PositionReceiptNote created

## Verified Facts

- L2 contract name: `AaveWrapper` (`aztec/src/main.nr:184`)
- L1 portal inherits: `Ownable2Step`, `Pausable` (`eth/contracts/AztecAavePortalL1.sol:43`)
- Deadline validation: MIN 5 min, MAX 24 hours (`eth/contracts/AztecAavePortalL1.sol:75-78`)
- Wormhole decimals: 8 (`target/contracts/AaveExecutorTarget.sol:103`)
- Target gas limit: 200,000 (`eth/contracts/AztecAavePortalL1.sol:84`)
- PXE port: 8080 (`docker-compose.yml:93`)
- L1 anvil port: 8545 (`docker-compose.yml:16`)
- Target anvil port: 8546 (`docker-compose.yml:56`)
- Health check timeout: 5 minutes default (`scripts/wait-for-services.sh:14`)

## Unknowns

- **Production deployment addresses**: Not configured; local devnet only
- **Wormhole testnet integration**: Mock contracts used for local testing
- **Gas estimates for E2E**: Not documented; depends on Aztec sandbox state

## Corrections

- `IMPLEMENTATION_PLAN_spec.md` states "0.8.24 (L1), 0.8.20 (Target)" → **Actually 0.8.33 for both** (verified in source files)
- `IMPLEMENTATION_PLAN_spec.md` states "Min deadline 30 min, max 7 days" → **Actually 5 min / 24 hours** per `AztecAavePortalL1.sol:75-78`
