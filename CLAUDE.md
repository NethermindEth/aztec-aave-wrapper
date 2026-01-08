# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aztec Aave Wrapper enables privacy-preserving Aave lending from Aztec L2 via Wormhole bridge. Users on Aztec can deposit into Aave on target chains (e.g., Arbitrum) while keeping their identity private.

**Architecture**: Three-layer "Aztec Uniswap L1-from-L2 tutorial pattern":
1. **L2 (Noir/aztec_contracts/)**: Creates private intents, manages encrypted position receipts
2. **L1 Portal (Solidity/l1/)**: Consumes Aztec messages, bridges via Wormhole
3. **Target Executor (Solidity/target/)**: Executes Aave operations on destination chain

The privacy model uses "anyone can execute" - L1/target execution doesn't require user identity. User authentication is via secret/secretHash mechanism.

## Build & Test Commands

```bash
# Check all tooling is installed
make check-tooling

# Build all contracts
make build           # Build all (L1, L2, Target)
make build-l1        # L1 portal: cd l1 && forge build
make build-l2        # L2 Noir:   cd aztec_contracts && aztec compile
make build-target    # Target:    cd target && forge build

# Run tests
make test            # All unit tests
make test-l1         # L1: cd l1 && forge test -vv
make test-l2         # L2: cd aztec_contracts && aztec test
make test-target     # Target: cd target && forge test -vv

# Run single Foundry test
cd l1 && forge test --match-test test_executeDeposit -vvv
cd target && forge test --match-test test_receiveDeposit -vvv

# E2E tests (requires running devnet)
make devnet-up       # Start Docker containers
make devnet-health   # Check services are ready
make e2e             # Run e2e tests: cd e2e && bun run test
make devnet-down     # Stop containers

# Formatting
make fmt             # Format all code
cd l1 && forge fmt   # Solidity formatting
cd aztec_contracts && aztec fmt  # Noir formatting

# Install dependencies
make install         # bun install + forge install for l1/target
```

## Key Files

**L2 Contract (Noir)**:
- `aztec_contracts/src/main.nr` - AaveWrapper contract with request_deposit, finalize_deposit, request_withdraw, finalize_withdraw
- `aztec_contracts/src/types/position_receipt.nr` - PositionReceiptNote (private encrypted note)
- `aztec_contracts/src/types/intent.nr` - DepositIntent, WithdrawIntent structs

**L1 Portal (Solidity)**:
- `l1/contracts/AztecAavePortalL1.sol` - Consumes L2 messages, bridges to target via Wormhole

**Target Executor (Solidity)**:
- `target/contracts/AaveExecutorTarget.sol` - Receives Wormhole messages, executes Aave supply/withdraw

**Tests**:
- `e2e/src/e2e.test.ts` - Full deposit/withdraw flow tests
- `aztec_contracts/src/test/*.nr` - Noir unit tests

## Dependencies & Versions

- **Noir**: aztec-nr from aztec-packages v3.0.0-devnet.20251212
- **Solidity**: 0.8.24 (L1), 0.8.20 (Target)
- **Foundry**: Latest (via foundryup)
- **Bun**: 1.1.0+ (package manager)
- **aztec.js**: ^0.65.0 (E2E tests)

## Local Development Environment

Docker Compose runs three services:
- `anvil-l1`: Ethereum L1 (port 8545)
- `anvil-target`: Target chain (port 8546)
- `aztec-sandbox`: Aztec PXE (port 8080)

**Important**: L1 anvil must NOT have `--block-time` set - Aztec sandbox controls L1 timing.

## Cross-Chain Message Flow

**Deposit**:
1. L2: `request_deposit()` creates DepositIntent, sends L2→L1 message
2. L1: Portal consumes message, bridges tokens via Wormhole `transferTokensWithPayload`
3. Target: Executor receives tokens+payload, supplies to Aave, sends confirmation
4. L1: Portal receives confirmation, sends L1→L2 message
5. L2: `finalize_deposit()` consumes message, creates PositionReceiptNote

**Withdrawal**: Similar reverse flow with `request_withdraw()` and `finalize_withdraw()`

## Privacy Considerations

- L2 owner address is NEVER included in cross-chain messages
- Authentication uses secret/secretHash (only secret holder can claim)
- Public events emit only intent_id and status, no user-identifying data
- Position receipts are encrypted notes visible only to the owner

## Git Commits

- Never mention Claude Code in commit messages
- Never include the generated footer or Co-Authored-By trailer
- Use imperative mood ("Add feature" not "Added feature")
- Keep commits small and focused
- Before committing update CHANGELOG.md based on the commit messages

## Code Quality

- Never bypass linting with exceptions unless explicitly requested
