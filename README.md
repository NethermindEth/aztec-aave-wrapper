# Aztec Aave Wrapper

Privacy-preserving Aave lending from Aztec L2.

## Quick Start

### Prerequisites

- **Docker**: For running local devnet
- **Foundry**: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- **Bun**: `curl -fsSL https://bun.sh/install | bash`
- **Aztec CLI**: `curl -L aztec.network | bash`

Verify installation:
```bash
make check-tooling
```

### Run the Full Flow Demo

```bash
# 1. Install dependencies
make install

# 2. Build all contracts
make build

# 3. Start local devnet and deploy contracts
make devnet-up

# 4. Run the full deposit/withdraw flow
cd e2e && bun run full-flow
```

The full-flow script demonstrates the complete user journey with real L1 contract deployment and balance tracking at each step.

## Overview

Aztec Aave Wrapper enables users on Aztec L2 to deposit into Aave V3 on Ethereum L1 while keeping their identity completely private. The system uses a two-layer architecture with cross-chain messaging to maintain privacy throughout the entire flow.

### Key Features

- **Privacy-Preserving**: User identity is never revealed on L1
- **Cross-Chain**: Bridge assets from Aztec L2 to Ethereum L1
- **Aave V3 Integration**: Earn yield on deposited assets via Aave lending
- **Relayer Model**: Anyone can execute L1 operations without knowing user identity

### MVP Constraints

- **USDC-only**: Single asset support for MVP
- **Full withdrawal only**: No partial withdrawals
- **L1 Aave only**: Direct deposit to Ethereum L1 Aave pool
- **Local devnet only**: Not production-ready

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              AZTEC L2                                    │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  AaveWrapper Contract (Noir)                                     │    │
│  │  - request_deposit()    → Creates private intent                 │    │
│  │  - finalize_deposit()   → Creates PositionReceiptNote            │    │
│  │  - request_withdraw()   → Initiates withdrawal                   │    │
│  │  - finalize_withdraw()  → Completes withdrawal                   │    │
│  │  - claim_refund()       → Refunds expired requests               │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                    │                                     │
│                           L2 → L1 Message                                │
│                         (hash(ownerL2) for privacy)                      │
└────────────────────────────────────┼────────────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           ETHEREUM L1                                    │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  AztecAavePortalL1 Contract (Solidity)                          │    │
│  │  - executeDeposit()    → Consumes L2 msg, deposits to Aave      │    │
│  │  - executeWithdraw()   → Withdraws from Aave, sends to L2       │    │
│  │  - Tracks per-intent shares for privacy                         │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                    │                                     │
│                              Aave V3 Pool                                │
└─────────────────────────────────────────────────────────────────────────┘
```

### Privacy Model

The system preserves user privacy through several mechanisms:

1. **Owner Hash**: The L2 owner address is hashed using Poseidon (`hash(ownerL2)`) before being included in cross-chain messages. This one-way hash prevents identity recovery.

2. **Relayer Model**: L1 operations can be executed by anyone. The relayer doesn't need to know the user's identity - they just process the intent.

3. **Secret/SecretHash**: Authentication for claiming L1→L2 messages uses a secret known only to the user.

4. **Minimal Public Data**: Public events emit only `intent_id` and status - no user-identifying information.

## What the Full Flow Demonstrates

The `full-flow` script shows the complete deposit journey with balance tracking:

```
📊 USER HAS USDC (starting point)
| User (L1)  | USDC  | 10.000000 |   ← User starts with USDC on L1

📊 AFTER USER FUNDS PORTAL
| User (L1)  | USDC  |  9.000000 |   ← User sends 1 USDC to portal
| Portal     | USDC  |  1.000000 |

📊 AFTER RELAYER EXECUTES DEPOSIT
| User (L1)  | USDC  |  9.000000 |
| Portal     | USDC  |  0.000000 |   ← Portal deposits to Aave
| Portal     | aUSDC |  1.000000 |   ← Portal receives aTokens
| Aave Pool  | USDC  |  1.000000 |   ← Aave holds the USDC
```

**Privacy Properties:**
- User's L2 address is NEVER revealed on L1
- `ownerHash` (Poseidon hash) used in cross-chain messages
- Relayer executes L1 operations (not user)
- `secret`/`secretHash` for authorization

## Development Commands

```bash
# Start/stop devnet
make devnet-up       # Start Anvil L1 + Aztec Sandbox + deploy contracts
make devnet-down     # Stop all containers
make devnet-health   # Check services are ready
make deploy-local    # Redeploy contracts (devnet must be running)
make devnet-clean    # Full cleanup with volume removal

# Build
make build           # Build all contracts
make build-l1        # L1 Solidity only
make build-l2        # L2 Noir only

# Test
make test            # All unit tests
make test-l1         # L1 Foundry tests
make test-l2         # L2 Noir tests
make e2e             # E2E integration tests

# Full flow demo
cd e2e && bun run full-flow
```

## Monitoring & Debugging

### View All Logs

```bash
make devnet-logs
```

### View Individual Service Logs

```bash
# L1 Ethereum node
docker compose logs anvil-l1 -f

# Aztec sandbox (PXE)
docker compose logs aztec-sandbox -f
```

### Check Service Health

```bash
make devnet-health
```

### Manual Health Checks

```bash
# Check L1 is responding
curl -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Check Aztec PXE
curl http://localhost:8081/status
```

### Troubleshooting

If services fail to start:

```bash
# Check for port conflicts
lsof -i :8545 -i :8081

# Clean restart
make devnet-clean
make devnet-up

# View Docker container status
docker compose ps
```

## Project Structure

```
aztec-aave-wrapper/
├── aztec/                     # L2 Noir contracts
│   ├── src/
│   │   ├── main.nr            # AaveWrapper contract
│   │   ├── types/
│   │   │   ├── intent.nr      # DepositIntent, WithdrawIntent
│   │   │   └── position_receipt.nr  # PositionReceiptNote
│   │   └── test/              # Noir unit tests
│   └── Nargo.toml
│
├── eth/                       # L1 Portal contracts
│   ├── contracts/
│   │   ├── AztecAavePortalL1.sol
│   │   ├── interfaces/        # IAztecOutbox, IAavePool, etc.
│   │   ├── types/             # Intent.sol, Confirmation.sol
│   │   └── mocks/             # MockAavePool contracts
│   └── foundry.toml
│
├── e2e/                       # End-to-end tests & demos
│   ├── scripts/
│   │   └── full-flow.ts       # Full deposit/withdraw demo script
│   └── src/
│       ├── e2e.test.ts        # Main test suite
│       ├── setup.ts           # Test harness
│       ├── flows/             # Deposit/withdraw orchestrators
│       └── utils/             # Aztec helpers
│
├── scripts/
│   ├── deploy-local.ts        # Contract deployment script
│   └── wait-for-services.sh   # Health check script
│
├── docker-compose.yml         # Local devnet configuration
├── Makefile                   # Build/test/deploy commands
├── .deployments.local.json    # Deployed contract addresses (generated)
└── CLAUDE.md                  # Developer guidelines
```

## Cross-Chain Message Flow

### Deposit Flow

1. **L2: User calls `request_deposit()`**
   - Validates amount and deadline
   - Computes `owner_hash = poseidon(owner)`
   - Creates unique `intent_id`
   - Sends L2→L1 message to portal
   - Stores `intent_id → owner` mapping

2. **L1: Relayer calls `executeDeposit()`**
   - Consumes message from Aztec outbox
   - Validates deadline (5 min - 24 hours)
   - Supplies tokens to Aave V3
   - Tracks per-intent shares
   - Sends L1→L2 confirmation message

3. **L2: User calls `finalize_deposit()`**
   - Consumes L1→L2 message (requires secret)
   - Creates `PositionReceiptNote` with Active status
   - Note is encrypted for user's viewing key

### Withdrawal Flow

Similar reverse flow:
1. User calls `request_withdraw()` with receipt nonce
2. L1 portal withdraws from Aave, sends tokens to Aztec token portal
3. User calls `finalize_withdraw()` to complete

### Refund Flow

If a withdrawal request expires:
1. User calls `claim_refund()` with expired nonce
2. PendingWithdraw note is nullified
3. New Active note is created with original position
4. User can try withdrawal again with new deadline

## Testing

### Unit Tests

```bash
make test            # All unit tests
make test-l1         # L1 Foundry tests
make test-l2         # L2 Noir tests

# Single Foundry test with verbose output
cd eth && forge test --match-test test_executeDeposit -vvv
```

### E2E Tests

Requires running devnet (contracts are deployed automatically):

```bash
make devnet-up
make e2e
```

### Full Flow Demo

The `full-flow` script demonstrates the complete deposit/withdraw flow with real L1 contracts:

```bash
cd e2e && bun run full-flow
```

This script:
- Uses contracts deployed by `make devnet-up`
- Shows user funding the portal with USDC
- Demonstrates relayer executing deposit on L1
- Tracks balances at each step
- Attempts withdrawal (requires real L1→L2 message)

E2E tests cover:
- Full deposit flow with privacy verification
- Full withdrawal flow
- Deadline expiry and refunds
- Multi-user concurrent operations
- Position isolation between users
- Replay protection

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANVIL_L1_PORT` | 8545 | L1 Ethereum RPC port |
| `PXE_PORT` | 8081 | Aztec PXE HTTP port |
| `ANVIL_L1_CHAIN_ID` | 31337 | L1 chain ID |
| `AZTEC_DEBUG` | `aztec:*` | Aztec debug logging |

### Contract Configuration

L1 Portal (`AztecAavePortalL1.sol`):
- `MIN_DEADLINE`: 5 minutes
- `MAX_DEADLINE`: 24 hours

## Key Concepts

### Intent ID

A unique identifier for each deposit/withdrawal request, computed as:
```
intent_id = poseidon(caller, asset, amount, original_decimals, deadline, salt)
```

### Position Receipt Note

A private Aztec note representing a user's claim on an Aave position:
- `owner`: Note owner (AztecAddress)
- `nonce`: Unique identifier (same as intent_id)
- `asset_id`: Asset identifier
- `shares`: Number of aToken shares
- `status`: Active, PendingWithdraw

### Per-Intent Share Tracking

The L1 portal tracks shares per `intent_id` (not per owner) to maintain privacy. This enables the anonymous pool model where the portal doesn't know which positions belong to which users.

### Retry Queue

If an Aave operation fails (e.g., pool paused, supply cap reached), the operation is added to a retry queue. Only the original caller can retry the operation, ensuring accountability.

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| aztec-nr | v3.0.0-devnet.20251212 | Noir contract framework |
| Solidity | 0.8.33 | Smart contract language |
| OpenZeppelin | 5.x | Security utilities (Ownable2Step, Pausable, SafeERC20) |
| Aave V3 Core | 1.x | Lending pool integration |
| aztec.js | ^0.65.0 | E2E test framework |
| viem | - | Ethereum client |
| vitest | - | Test runner |

## License

MIT

## Contributing

See [CLAUDE.md](./CLAUDE.md) for development guidelines.
