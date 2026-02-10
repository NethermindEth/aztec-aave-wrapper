# Aave V3 Sepolia Integration Guide

This document describes how to integrate with the real Aave V3 deployment on Ethereum Sepolia for the Aztec Aave Wrapper devnet deployment.

## Overview

When deploying to Aztec Devnet + Ethereum Sepolia, we use the **real Aave V3 protocol** instead of mock contracts. This provides a more realistic testing environment.

**Important:** Aave V3 Sepolia uses its own test USDC token, NOT Circle's official Sepolia USDC (`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`). You must use Aave's test tokens.

## Contract Addresses

### Aave V3 Core Contracts (Sepolia)

| Contract | Address |
|----------|---------|
| Pool | `0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951` |
| PoolAddressesProvider | `0x012bAC54348C0E635dCAc9D5FB99f06F24136C9A` |
| Faucet | `0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D` |

### USDC Token (Sepolia)

| Contract | Address |
|----------|---------|
| USDC (underlying) | `0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8` |
| aUSDC (aToken) | `0x16dA4541aD1807f4443d92D26044C1147406EB80` |
| vUSDC (variable debt) | `0x36B5dE936eF1710E1d22EabE5231b28581a92ECc` |
| USDC Oracle | `0x98458D6A99489F15e6eB5aFa67ACFAcf6F211051` |

### Aztec L1 Contracts (Sepolia)

| Contract | Address |
|----------|---------|
| Registry | `0x548ed380440c3eef42f222ceda1d6770b8999f8c` |
| Rollup | `0x5d84b64b0b2f468df065d8cf01fff88a73238a13` |
| Inbox (L1→L2) | `0x8ea98d35d7712ca236ac7a2b2f468df065d8cf01fff88a73238a13` |
| Outbox (L2→L1) | `0x6628f5648dcee4ee4c3262ed35a995039cadb669` |
| Fee Juice Portal | `0x5eee7cb811f638b70fe1a04d2318530c55d7bd87` |

## Getting Test Tokens

### Aave Faucet (Direct Contract Call)

The Aave faucet on Sepolia is **not permissioned**, meaning anyone can mint test tokens directly without using the web UI.

**Faucet Details:**
- Address: `0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D`
- Max per mint: 10,000 tokens
- No cooldown between mints

**Mint USDC via cast:**

```bash
# Mint 1000 USDC (amount in base units: 1000 * 10^6 = 1000000000)
cast send 0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D \
  "mint(address,address,uint256)" \
  0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8 \
  YOUR_WALLET_ADDRESS \
  1000000000 \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --private-key YOUR_PRIVATE_KEY
```

**Function signature:**
```solidity
function mint(
  address token,    // Token to mint (USDC: 0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8)
  address to,       // Recipient address
  uint256 amount    // Amount in base units (USDC has 6 decimals)
) external returns (uint256)
```

### Sepolia ETH (for gas)

You need Sepolia ETH to pay for L1 transaction gas. Available faucets:

| Faucet | URL | Amount |
|--------|-----|--------|
| Alchemy | https://www.alchemy.com/faucets/ethereum-sepolia | 0.1 ETH / 72h |
| QuickNode | https://faucet.quicknode.com/ethereum/sepolia | 0.05 ETH / 12h |
| Chainlink | https://faucets.chain.link/sepolia | 0.1 ETH / day |
| Google Cloud | https://cloud.google.com/application/web3/faucet/ethereum/sepolia | 0.05 ETH |

## Aztec Devnet Configuration

### RPC Endpoints

| Network | URL |
|---------|-----|
| Aztec Devnet | `https://devnet-6.aztec-labs.com` |
| Ethereum Sepolia | `https://ethereum-sepolia-rpc.publicnode.com` |

### Chain IDs

| Network | Chain ID |
|---------|----------|
| Ethereum Sepolia | 11155111 |

### Fee Payment (Sponsored FPC)

Unlike local development, Aztec Devnet requires fee payment for L2 transactions. During devnet testing, you can use the **Sponsored FPC** (Fee Payment Contract) which covers transaction fees:

```
SPONSORED_FPC_ADDRESS=0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e
```

Register it in your wallet before deploying contracts:
```typescript
await wallet.registerSponsoredFPC(sponsoredFpcAddress);
```

## Key Differences from Local Development

| Aspect | Local (Anvil + Sandbox) | Devnet (Sepolia + Aztec) |
|--------|------------------------|--------------------------|
| Aave Pool | MockLendingPool | Real Aave V3 Pool |
| USDC | MockERC20 | Aave test USDC |
| L1 Block Time | Instant | ~12 seconds |
| L2 Block Time | Instant | ~36 seconds |
| L2 Proving | Disabled | Enabled (slower txs) |
| L2 Fees | None | Required (use Sponsored FPC) |
| Test Accounts | Pre-deployed | Manual deployment |

## Deployment

### Prerequisites

1. Copy `.env.devnet.example` to `.env.devnet`
2. Add your deployer private key (must have Sepolia ETH)
3. Build contracts: `make build`

### Deploy Command

```bash
bun run deploy:devnet
```

This deploys:
- **L1 (Sepolia):** TokenPortal, AztecAavePortalL1
- **L2 (Aztec Devnet):** BridgedToken, AaveWrapper

### Deployment Output

Addresses are saved to:
- `.deployments.devnet.json` (project root)
- `frontend/public/.deployments.devnet.json` (frontend)

## Interacting with Aave V3

### Supply USDC to Aave (Direct)

```bash
# First approve the Pool to spend USDC
cast send 0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8 \
  "approve(address,uint256)" \
  0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951 \
  1000000000 \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --private-key YOUR_KEY

# Supply 1000 USDC
cast send 0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951 \
  "supply(address,uint256,address,uint16)" \
  0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8 \
  1000000000 \
  YOUR_ADDRESS \
  0 \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --private-key YOUR_KEY
```

### Check aUSDC Balance

```bash
cast call 0x16dA4541aD1807f4443d92D26044C1147406EB80 \
  "balanceOf(address)(uint256)" \
  YOUR_ADDRESS \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com
```

## Block Explorers

| Network | Explorer |
|---------|----------|
| Ethereum Sepolia | https://sepolia.etherscan.io |
| Aztec Devnet | https://devnet.aztecscan.xyz |

## References

- [Aave V3 Sepolia Address Book](https://github.com/bgd-labs/aave-address-book/blob/main/src/AaveV3Sepolia.sol)
- [Aztec Networks Documentation](https://docs.aztec.network/networks)
- [Aztec Devnet Getting Started](https://docs.aztec.network/developers/getting_started_on_devnet)
- [Aave V3 Documentation](https://docs.aave.com/developers)
