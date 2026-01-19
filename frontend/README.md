# Aztec Aave Wrapper Frontend

Minimal SolidJS frontend for the Aztec Aave Wrapper - enabling privacy-preserving Aave lending from Aztec L2 to Ethereum L1.

## Prerequisites

- [Bun](https://bun.sh) 1.1.0+
- Running devnet (`make devnet-up` from project root)

## Installation

```bash
bun install
```

## Available Scripts

### `bun run dev`

Runs the app in development mode.
Open [http://localhost:5173](http://localhost:5173) to view it in the browser.

The page will reload if you make edits.

### `bun run build`

Builds the app for production to the `dist` folder.
It correctly bundles Solid in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.
Your app is ready to be deployed!

### `bun run preview`

Preview the production build locally.

## User Flows

### Bridge Flow

Bridge USDC from Ethereum L1 to Aztec L2. This is a prerequisite before depositing to Aave with privacy.

**Steps:**
1. **Approve TokenPortal** - Approve the TokenPortal contract to spend your USDC on L1
2. **Deposit to TokenPortal** - Lock USDC in the TokenPortal and create an L1→L2 cross-chain message
3. **Claim on L2** - Claim your bridged tokens on Aztec L2 via the BridgedToken contract

After bridging, your USDC will be available as private L2 tokens that can be used for Aave deposits.

### Deposit Flow

Deposit L2 USDC into Aave V3 on Ethereum L1 while preserving privacy.

**Steps:**
1. **Generate secret** - Create a random secret for your private position
2. **Request deposit on L2** - Create a private deposit intent on Aztec L2 (burns L2 tokens)
3. **Wait for L2→L1 message** - Cross-chain message propagates to Ethereum
4. **Execute deposit on L1** - Execute the Aave deposit on Ethereum (anyone can relay)
5. **Wait for L1→L2 message** - Confirmation message propagates back to Aztec
6. **Finalize deposit on L2** - Create your encrypted position receipt on Aztec

Your position is tracked via an encrypted PositionReceiptNote that only you can access.

### Withdraw Flow

Withdraw your full position from Aave back to L2 tokens.

**Steps:**
1. **Request withdrawal on L2** - Create a private withdrawal intent (nullifies position receipt)
2. **Wait for L2→L1 message** - Cross-chain message propagates to Ethereum
3. **Execute withdrawal on L1** - Withdraw from Aave and deposit to TokenPortal
4. **Finalize withdrawal on L2** - Complete the withdrawal on Aztec
5. **Claim tokens on L2** - Claim withdrawn tokens via BridgedToken contract

Note: Full withdrawal only - the entire position must be withdrawn at once.

### Cancel Deposit

Cancel a pending deposit to reclaim your L2 tokens when the deadline passes without L1 execution.

**When to use:**
- Your deposit intent has expired (deadline passed)
- The L1 execution was never completed
- Intent is still in PENDING_DEPOSIT status

**What happens:**
1. **Validate deadline** - Verify current L1 time exceeds the intent deadline
2. **Cancel on L2** - Call cancel_deposit to mint refund tokens back to your wallet

The cancelled intent is removed from your positions list and your tokens are returned.

### Token Claim

Claim tokens that are pending after a successful withdrawal.

**When available:**
- Withdrawal has completed on L1
- Position shows "Pending Withdraw" status
- Secret for the position is stored locally

**How to claim:**
1. Navigate to the Withdraw tab
2. Find your position in the "Pending Claims" section
3. Click "Claim tokens" to receive your L2 USDC

## Learn More

- [Solid Website](https://solidjs.com)
- [Solid Discord](https://discord.com/invite/solidjs)
- [Project Documentation](../docs/frontend-requirements.md)
