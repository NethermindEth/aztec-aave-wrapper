# Local Devnet Deployment Guide

This guide provides step-by-step instructions for deploying the Aztec Aave Wrapper to a local development network.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Detailed Setup](#detailed-setup)
4. [Deployment Steps](#deployment-steps)
5. [Verification](#verification)
6. [Running Tests](#running-tests)
7. [Configuration Reference](#configuration-reference)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Tools

Verify all required tools are installed:

```bash
make check-tooling
```

Expected output shows these tools installed:
- **Docker** (with Docker Compose)
- **Foundry** (forge, cast, anvil)
- **Bun** (1.1.0+)
- **Aztec CLI** (aztec)

### Installation Instructions

If any tools are missing:

```bash
# Docker
# See https://docs.docker.com/get-docker/

# Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Bun
curl -fsSL https://bun.sh/install | bash

# Aztec CLI
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
noirup
aztec-install
```

### System Requirements

- **RAM**: 8GB minimum (16GB recommended)
- **Disk**: 10GB free space
- **Ports**: 8545, 8546, 8080 available

---

## Quick Start

For experienced users, here's the minimal command sequence:

```bash
# 1. Install dependencies
make install

# 2. Build all contracts
make build

# 3. Start devnet
make devnet-up

# 4. Wait for services (up to 5 minutes for first run)
make devnet-health

# 5. Deploy contracts
make deploy-local

# 6. Run E2E tests
make e2e

# 7. When done
make devnet-down
```

---

## Detailed Setup

### Step 1: Clone and Install Dependencies

```bash
# Clone the repository (if not already done)
git clone <repository-url>
cd aztec-aave-wrapper

# Install all dependencies
make install
```

This runs:
- `bun install` - JavaScript/TypeScript dependencies
- `forge install` - Solidity dependencies for L1 and Target contracts

### Step 2: Environment Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Default configuration works for local development. Key settings:

| Variable | Default | Description |
|----------|---------|-------------|
| `ANVIL_L1_PORT` | 8545 | L1 Ethereum RPC port |
| `ANVIL_TARGET_PORT` | 8546 | Target chain RPC port |
| `PXE_PORT` | 8080 | Aztec PXE endpoint |
| `AZTEC_VERSION` | latest | Aztec sandbox Docker image |

### Step 3: Build Contracts

Build all contracts before deployment:

```bash
# Build everything
make build

# Or build individually
make build-l1      # L1 Solidity (Portal)
make build-l2      # L2 Noir (AaveWrapper)
make build-target  # Target Solidity (Executor)
```

Expected output:
- L1: `l1/out/*.sol/*.json` artifacts
- L2: `aztec_contracts/target/*.json` artifacts
- Target: `target/out/*.sol/*.json` artifacts

---

## Deployment Steps

### Step 4: Start Local Devnet

Start the Docker Compose services:

```bash
make devnet-up
```

This starts three containers:
1. **anvil-l1** - Simulates Ethereum L1 (port 8545)
2. **anvil-target** - Simulates target chain like Arbitrum (port 8546)
3. **aztec-sandbox** - Full Aztec development environment (port 8080)

**Important**: First startup may take 2-5 minutes as the Aztec sandbox initializes and deploys L1 contracts.

### Step 5: Verify Services Are Ready

Wait for all services to become healthy:

```bash
make devnet-health
```

This script polls each service until ready (default timeout: 5 minutes).

Expected output:
```
==========================================
 Aztec Aave Wrapper - Service Health Check
==========================================

[INFO] Starting health checks (timeout: 300s)

[OK] Anvil L1 (port 8545) is healthy
[OK] Anvil Target (port 8546) is healthy
[OK] PXE/Aztec Sandbox (port 8080) is healthy

==========================================
[OK] All services are healthy!

Service endpoints:
  - Anvil L1:     http://localhost:8545
  - Anvil Target: http://localhost:8546
  - PXE:          http://localhost:8080
```

### Step 6: Deploy Contracts

Deploy all contracts to the local devnet:

```bash
make deploy-local
```

Deployment sequence:
1. Deploy AztecAavePortalL1 on L1
2. (Future) Deploy AaveExecutorTarget on Target

Addresses are saved to `.deployments.local.json`.

### Step 7: Update E2E Test Addresses

After deployment, update the test configuration with deployed addresses:

```bash
# View deployed addresses
cat .deployments.local.json

# Update e2e/src/config/addresses.json with actual addresses
```

---

## Verification

### Verify L1 Contracts

```bash
# Check L1 block number
cast block-number --rpc-url http://localhost:8545

# Check a deployed contract
cast code <PORTAL_ADDRESS> --rpc-url http://localhost:8545
```

### Verify Target Contracts

```bash
# Check target chain
cast block-number --rpc-url http://localhost:8546

# Verify contract deployment
cast code <EXECUTOR_ADDRESS> --rpc-url http://localhost:8546
```

### Verify Aztec Sandbox

```bash
# Check PXE status
curl http://localhost:8080/status

# Or use Aztec CLI
aztec pxe get-info -u http://localhost:8080
```

---

## Running Tests

### Unit Tests

Run unit tests for each layer:

```bash
# All unit tests
make test

# Individual layers
make test-l1      # L1 portal tests
make test-l2      # L2 Noir contract tests
make test-target  # Target executor tests
```

### E2E Tests

Run end-to-end tests against the running devnet:

```bash
# Ensure devnet is running and healthy
make devnet-health

# Run E2E tests
make e2e

# Watch mode (re-runs on file changes)
make e2e-watch
```

### Single Test Execution

Run a specific test:

```bash
# L1 specific test
cd l1 && forge test --match-test test_executeDeposit -vvv

# Target specific test
cd target && forge test --match-test test_receiveDeposit -vvv

# L2 specific test
cd aztec_contracts && aztec test --filter "test_request_deposit"
```

---

## Configuration Reference

### Service Ports

| Service | Port | Description |
|---------|------|-------------|
| Anvil L1 | 8545 | Ethereum L1 JSON-RPC |
| Anvil Target | 8546 | Target chain JSON-RPC |
| PXE | 8080 | Aztec Private Execution Environment |

### Test Accounts

Default Anvil accounts (DO NOT use on mainnet):

| Account | Address | Private Key |
|---------|---------|-------------|
| Deployer | 0xf39F...2266 | 0xac0974bec...f2ff80 |
| User 1 | 0x70997...E5aB | 0x59c6995e9...78690d |
| User 2 | 0x3C44C...bF2d | 0x5de4111af...ab365a |
| Relayer | 0x90F79...ABf6 | (see .env.example) |

### Chain IDs

| Chain | Chain ID | Wormhole ID |
|-------|----------|-------------|
| Anvil L1 | 31337 | 2 (Ethereum) |
| Anvil Target | 31338 | 23 (Arbitrum) |

---

## Troubleshooting

### Services Won't Start

**Symptom**: `make devnet-up` fails or containers exit immediately.

**Solutions**:
1. Check Docker is running: `docker info`
2. Check port conflicts: `lsof -i :8545 -i :8546 -i :8080`
3. Free up memory (Aztec sandbox needs ~4GB)
4. View logs: `make devnet-logs`

### PXE Takes Forever to Start

**Symptom**: `make devnet-health` times out waiting for PXE.

**Solutions**:
1. Increase timeout: `TIMEOUT=600 make devnet-health`
2. Check Aztec logs: `docker compose logs aztec-sandbox`
3. Ensure L1 anvil is healthy (PXE depends on it)
4. Try restarting: `make devnet-clean && make devnet-up`

### Deployment Fails

**Symptom**: `make deploy-local` errors out.

**Solutions**:
1. Verify services are healthy: `make devnet-health`
2. Rebuild contracts: `make clean && make build`
3. Check RPC connectivity:
   ```bash
   curl -X POST http://localhost:8545 \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
   ```

### Tests Fail with "PXE not available"

**Symptom**: E2E tests skip with PXE connection errors.

**Solutions**:
1. Verify PXE is running: `curl http://localhost:8080/status`
2. Check if using correct Node.js version (v20 or v22, not v23)
3. Restart the sandbox: `make devnet-restart`

### Transaction Mining Timeouts

**Symptom**: L1 transactions hang or timeout.

**Cause**: Block time misconfiguration.

**Solution**:
- Do NOT set `--block-time` on anvil-l1
- Aztec sandbox controls L1 block production
- If you modified docker-compose.yml, restore it

### Memory/Performance Issues

**Symptom**: Slow performance, containers killed.

**Solutions**:
1. Increase Docker memory limit (8GB recommended)
2. Close other memory-intensive applications
3. Disable debug logging: `AZTEC_DEBUG= make devnet-up`
4. Use specific Aztec version instead of `latest`

### Clean Restart

If all else fails, perform a complete reset:

```bash
# Stop and remove all containers/volumes
make devnet-clean

# Rebuild everything
make clean
make build

# Fresh start
make devnet-up
make devnet-health
make deploy-local
```

---

## Common Operations

### View Logs

```bash
# All services
make devnet-logs

# Specific service
docker compose logs -f anvil-l1
docker compose logs -f aztec-sandbox
```

### Restart Services

```bash
# Restart all
make devnet-restart

# Restart specific service
docker compose restart aztec-sandbox
```

### Reset State

```bash
# Keep containers, reset chain state
make devnet-down
make devnet-up

# Full reset including volumes
make devnet-clean
make devnet-up
```

### Check Deployment Addresses

```bash
# View saved addresses
cat .deployments.local.json
```

---

## Next Steps

After successful local deployment:

1. **Run the full test suite**: `make test && make e2e`
2. **Explore the contracts**: Review code in `l1/`, `aztec_contracts/`, `target/`
3. **Read the architecture**: See `docs/IMPLEMENTATION_NOTES.md`
4. **Try manual operations**: Use `cast` to interact with deployed contracts
