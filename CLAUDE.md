# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aztec Aave Wrapper enables privacy-preserving Aave lending from Aztec L2 to Ethereum L1. Users on Aztec can deposit into Aave V3 on Ethereum L1 while keeping their identity private.

**Architecture**: Two-layer architecture:
1. **L2 (Noir/aztec)**: Creates private intents, manages encrypted position receipts
2. **L1 Portal (Solidity/eth)**: Consumes Aztec messages, executes Aave operations directly

**Privacy model**: Uses hash(ownerL2) to protect user identity across chains while enabling verification. L1 execution doesn't require user identity ("anyone can execute" relay model).

## Build & Test Commands

```bash
# Check all tooling is installed
make check-tooling

# Build all contracts
make build           # Build all (L1, L2)
make build-l1        # L1 portal: cd eth && forge build
make build-l2        # L2 Noir:   cd aztec && aztec compile

# Run tests
make test            # All unit tests
make test-l1         # L1: cd eth && forge test -vv
make test-l2         # L2: cd aztec && aztec test

# Run single Foundry test
cd eth && forge test --match-test test_executeDeposit -vvv

# E2E tests (requires running devnet)
make devnet-up       # Start Docker containers
make devnet-health   # Check services are ready
make e2e             # Run e2e tests: cd e2e && bun run test
make devnet-down     # Stop containers

# Formatting
make fmt             # Format all code
cd eth && forge fmt   # Solidity formatting
cd aztec && aztec fmt  # Noir formatting

# Install dependencies
make install         # bun install + forge install for l1
```

## Key Files

**L2 Contract (Noir)**:
- `aztec/src/main.nr` - AaveWrapper contract with request_deposit, finalize_deposit, request_withdraw, finalize_withdraw
- `aztec/src/types/position_receipt.nr` - PositionReceiptNote (private encrypted note)
- `aztec/src/types/intent.nr` - DepositIntent, WithdrawIntent structs

**L1 Portal (Solidity)**:
- `eth/contracts/AztecAavePortalL1.sol` - Consumes L2 messages, executes Aave operations directly

**Tests**:
- `e2e/src/e2e.test.ts` - Full deposit/withdraw flow tests
- `aztec/src/test/*.nr` - Noir unit tests

## Dependencies & Versions

- **Noir**: aztec-nr from aztec-packages v3.0.0-devnet.20251212
- **Solidity**: 0.8.33
- **Foundry**: Latest (via foundryup)
- **Bun**: 1.1.0+ (package manager)
- **aztec.js**: ^0.65.0 (E2E tests)

## Local Development Environment

Docker Compose runs two services:
- `anvil-l1`: Ethereum L1 (port 8545)
- `aztec-sandbox`: Aztec PXE (port 8081)

**Important**: L1 anvil must NOT have `--block-time` set - Aztec sandbox controls L1 timing.

## Cross-Chain Message Flow

**Deposit**:
1. L2: `request_deposit()` creates DepositIntent, sends L2→L1 message
2. L1: Portal consumes message, supplies tokens to Aave V3, tracks per-intent shares, sends L1→L2 confirmation
3. L2: `finalize_deposit()` consumes message, creates PositionReceiptNote

**Withdrawal**: Similar reverse flow with `request_withdraw()` and `finalize_withdraw()`

## Architecture Details

### Privacy Model
- **hash(ownerL2)**: L2 owner address is hashed (Poseidon) before inclusion in cross-chain messages
- Owner identity is never revealed on L1
- L2 maintains `intent_owners` mapping to resolve owner during finalization
- Public events emit only intent_id and status, no user-identifying data

### Key Implementation Decisions
- **Per-intent share tracking**: L1 portal tracks shares per intent ID (not per owner) to maintain privacy
- **Full withdrawal only**: Withdrawals must be for the entire position (simplifies note lifecycle)
- **Retry queue**: Failed operations queued indefinitely, retryable by original caller
- **Deadline enforcement at L1**: 5 min minimum, 24 hour maximum (L2 has no block.timestamp access)

### MVP Constraints
- **USDC-only**: MVP focuses on single asset support (multi-asset structure exists but not tested)
- **L1 Aave only**: Direct deposit to Ethereum L1 Aave pool

## Git Commits

- Never mention Claude Code in commit messages
- Never include the generated footer or Co-Authored-By trailer
- Use imperative mood ("Add feature" not "Added feature")
- Keep commits small and focused
- Before committing update CHANGELOG.md based on the commit messages

## Code Quality

- Never bypass linting with exceptions unless explicitly requested
