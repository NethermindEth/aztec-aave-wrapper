# Spec: Privacy-Preserving Deposit Flow (Implemented)

## Summary

This document describes the privacy-preserving deposit flow that has been implemented. The flow requires users to first bridge USDC to L2, then request Aave deposits from their private L2 balance. This breaks the link between the user's L1 wallet and their Aave position.

## Implementation Status

All core functionality has been implemented and tested.

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Token source for deposits | L2 bridged USDC | Breaks link between L1 wallet and Aave position |
| Old L1-direct flow | Removed entirely | No reason to keep non-private path |
| L2 → L1 token movement | Burn on L2, claim from TokenPortal on L1 | Standard Aztec bridge pattern |
| Request atomicity | Single L2 tx | User calls request_deposit which burns tokens + sends L2→L1 message |
| L1 execution | Anyone can execute | Permissionless relay model |
| Fee mechanism | 0.1% transferred to protocol treasury | Simple, predictable fee to treasury address |
| Liveness failure handling | Anyone can execute + timeout refund | Dual mechanism for safety |
| Timeout refund source | Mint new L2 tokens via BridgedToken | L2 contract authorized to mint if L1 execution never happened |
| Minimum deposit | 1 USDC (1,000,000 base units) | Ensures meaningful deposits and non-zero fees |
| Token type required | Canonical bridged USDC | Must use TokenPortal-bridged token via BridgedToken contract |
| Bridge implementation | Aztec reference contracts | Uses official token bridge pattern |

## Requirements (Completed)

### Must Have
- [x] Deploy TokenPortal (L1) and BridgedToken contract for USDC in local sandbox
- [x] Modify `request_deposit` to burn L2 tokens via BridgedToken.burn_from
- [x] Modify `executeDeposit` to claim tokens from TokenPortal via withdraw()
- [x] Remove approve+transfer steps from frontend deposit flow
- [x] Add fee deduction logic (0.1%) - fee transferred to treasury before burn
- [x] Implement timeout + refund mechanism via `cancel_deposit()`
- [x] Update frontend to show separate "Bridge to L2" and "Deposit to Aave" flows

### Must Not
- [x] User's L1 wallet does NOT interact with AavePortal during deposit
- [x] L1 events contain only intentId - no user-identifying information
- [x] Relayer is NOT required - anyone can execute

## Behavior

### Deposit Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PRIVACY-PRESERVING DEPOSIT FLOW                           │
└─────────────────────────────────────────────────────────────────────────────┘

PREREQUISITE (Separate Flow - can be done days/weeks earlier):
══════════════════════════════════════════════════════════════
User bridges USDC from L1 to L2 via TokenPortal
  │
  ├── TX A: User approves TokenPortal for USDC (L1 - MetaMask)
  ├── TX B: User calls TokenPortal.depositToAztecPrivate() (L1 - MetaMask)
  │         └── Tokens held by TokenPortal on L1
  └── TX C: User claims L2 USDC via BridgedToken.claim_private() (L2 - Azguard)
            └── User now has private L2 USDC balance

DEPOSIT FLOW (Privacy-Preserving):
══════════════════════════════════
User clicks "Deposit to Aave"
         │
         ▼
╔═════════════════════════════════════════════════════════════════════════════╗
║  TX #1: REQUEST DEPOSIT (L2 - Aztec)                                        ║
╠═════════════════════════════════════════════════════════════════════════════╣
║  Signer:    User via Azguard Wallet                                         ║
║  Contract:  AaveWrapper (L2)                                                ║
║  Function:  request_deposit(asset, amount, original_decimals,               ║
║                             deadline, secret_hash)                          ║
║                                                                             ║
║  Actions:                                                                   ║
║  ├── Validate amount >= MIN_DEPOSIT_AMOUNT (1,000,000 = 1 USDC)             ║
║  ├── Calculate fee (0.1%) and net_amount                                    ║
║  ├── Transfer fee to protocol treasury via BridgedToken.transfer_from      ║
║  ├── Burn user's L2 USDC (net_amount) via BridgedToken.burn_from            ║
║  ├── Compute ownerHash = poseidon2_hash(caller) for privacy                 ║
║  ├── Compute salt = poseidon2_hash(caller, secret_hash) for uniqueness      ║
║  ├── Compute intent_id from all parameters                                  ║
║  ├── Send L2→L1 message with deposit intent to portal                       ║
║  └── Store intent_owners, intent_deadlines, intent_net_amounts, status      ║
╚═════════════════════════════════════════════════════════════════════════════╝
         │
         │  L2 → L1 Message (async, ~2 blocks)
         │  Contains: intentId, ownerHash, asset, net_amount, original_decimals,
         │            deadline, salt, secretHash
         ▼
╔═════════════════════════════════════════════════════════════════════════════╗
║  TX #2: EXECUTE DEPOSIT (L1 - Ethereum)                                     ║
╠═════════════════════════════════════════════════════════════════════════════╣
║  Signer:    Anyone (relayer or user from fresh wallet)                      ║
║  Contract:  AztecAavePortalL1                                               ║
║  Function:  executeDeposit(intent, l2BlockNumber, leafIndex, siblingPath)   ║
║                                                                             ║
║  Actions:                                                                   ║
║  ├── Check consumedDepositIntents[intentId] for replay protection           ║
║  ├── Validate deadline (5 min to 24 hours from now)                         ║
║  ├── Consume L2→L1 message from Aztec outbox                                ║
║  ├── Mark consumedDepositIntents[intentId] = true                           ║
║  ├── Claim tokens from TokenPortal via withdraw()                           ║
║  ├── Approve and supply tokens to Aave V3                                   ║
║  ├── Track intentShares[intentId] and intentAssets[intentId]                ║
║  └── Send L1→L2 confirmation message (intentId, asset, shares)              ║
╚═════════════════════════════════════════════════════════════════════════════╝
         │
         │  L1 → L2 Message (async, ~10 blocks)
         │  Contains: intentId, asset, shares (secretHash passed separately)
         ▼
╔═════════════════════════════════════════════════════════════════════════════╗
║  TX #3: FINALIZE DEPOSIT (L2 - Aztec)                                       ║
╠═════════════════════════════════════════════════════════════════════════════╣
║  Signer:    User via Azguard Wallet                                         ║
║  Contract:  AaveWrapper (L2)                                                ║
║  Function:  finalize_deposit(intent_id, asset_id, shares, secret,           ║
║                              message_leaf_index)                            ║
║                                                                             ║
║  Actions:                                                                   ║
║  ├── Consume L1→L2 message (verifies secret)                                ║
║  ├── Create PositionReceiptNote (encrypted, status=ACTIVE)                  ║
║  ├── Insert note into user's private receipts set                           ║
║  ├── Mark consumed_intents[intentId] = true                                 ║
║  ├── Update intent_status[intentId] = CONFIRMED                             ║
║  └── Clear intent_owners, intent_deadlines, intent_net_amounts              ║
╚═════════════════════════════════════════════════════════════════════════════╝
```

### Token Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TOKEN FLOW                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   BRIDGE PHASE (one-time, can be done in advance):                          │
│   ═══════════════════════════════════════════════                           │
│                                                                             │
│   L1: User Wallet ──USDC──► TokenPortal (holds USDC)                        │
│                                   │                                         │
│                                   │ L1→L2 message                           │
│                                   ▼                                         │
│   L2: BridgedToken mints ──L2USDC──► User L2 Balance (private)              │
│                                                                             │
│   DEPOSIT PHASE (privacy-preserving):                                       │
│   ══════════════════════════════════                                        │
│                                                                             │
│   L2: User L2 Balance ──transfer (0.1% fee)──► Protocol Treasury            │
│            │                                                                │
│            └──burn (net_amount)──► AaveWrapper (records intent)             │
│                                          │                                  │
│                                          │ L2→L1 message                    │
│                                          ▼                                  │
│   L1: TokenPortal ──USDC──► AavePortal ──USDC──► Aave Pool                  │
│                    (claim)              (supply)     │                      │
│                                                      │                      │
│   L1: Aave Pool ──aUSDC──► AavePortal (holds shares)                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Edge Cases

| Case | Behavior |
|------|----------|
| L1 execution never happens | After deadline, user can call `cancel_deposit()` on L2 to mint net_amount back |
| Relayer executes but L1→L2 message fails | User can retry `finalize_deposit()` - message remains consumable |
| User tries to cancel after L1 execution | Cancel fails - intent already consumed on L1 (intent marked consumed on L2) |
| Deposit amount < MIN_DEPOSIT_AMOUNT | Transaction reverts ("Amount must be at least minimum deposit amount") |
| Net amount after fee is 0 | Transaction reverts ("Net amount after fee must be greater than zero") |
| TokenPortal has insufficient L1 reserves | executeDeposit reverts - should not happen if bridge is consistent |
| User double-spends L2 tokens | Impossible - tokens burned atomically in request_deposit |
| Deadline too short (<5 min) or too long (>24h) | L1 executeDeposit reverts with InvalidDeadline |

### Timeout Refund Flow (cancel_deposit)

```
User calls request_deposit(asset, amount, decimals, deadline, secret_hash)
         │
         ├── Fee (0.1%) transferred to treasury
         ├── L2 tokens burned (net_amount)
         ├── Intent created with deadline
         ├── intent_net_amounts[intentId] = net_amount (stored for refund)
         │
         ▼
    [Deadline passes without L1 execution]
         │
         ▼
User calls cancel_deposit(intentId, current_time, net_amount)
         │
         ├── Private: Mint net_amount back to user via BridgedToken.mint_private
         │
         └── Public (_cancel_deposit_public):
             ├── Verify intent status is PENDING_DEPOSIT
             ├── Verify intent not already consumed
             ├── Verify caller owns the intent
             ├── Verify deadline has passed (current_time > deadline)
             ├── Verify net_amount matches stored value
             ├── Mark intent as consumed
             ├── Set status to CANCELLED
             └── Clear intent_owners, intent_deadlines, intent_net_amounts
```

**Note**: The fee (0.1%) is NOT refunded on cancellation - only the net_amount is returned.

## Technical Details

### Fee Configuration (L2 AaveWrapper)
```rust
pub mod FeeConfig {
    pub global FEE_BASIS_POINTS: u128 = 10;           // 0.1%
    pub global BASIS_POINTS_DENOMINATOR: u128 = 10000; // 100%
    pub global MIN_DEPOSIT_AMOUNT: u128 = 1_000_000;   // 1 USDC (6 decimals)
}
```

### Deadline Constraints (L1 AztecAavePortalL1)
```solidity
uint256 public constant MIN_DEADLINE = 5 minutes;
uint256 public constant MAX_DEADLINE = 24 hours;
```

### Intent Status Values (L2 AaveWrapper)
```rust
pub mod IntentStatus {
    pub global UNKNOWN: u8 = 0;
    pub global PENDING_DEPOSIT: u8 = 1;
    pub global CONFIRMED: u8 = 2;
    pub global FAILED: u8 = 3;
    pub global PENDING_WITHDRAW: u8 = 4;
    pub global CANCELLED: u8 = 5;
}
```

### L2 Storage Mappings
| Mapping | Purpose |
|---------|---------|
| `intent_status` | Tracks intent lifecycle (UNKNOWN → PENDING_DEPOSIT → CONFIRMED/CANCELLED) |
| `consumed_intents` | Replay protection - true after finalization or cancellation |
| `intent_owners` | Maps intentId to L2 owner for authorization checks |
| `intent_deadlines` | Maps intentId to deadline for cancel validation |
| `intent_net_amounts` | Maps intentId to net amount for cancel refunds |

### L1 Storage Mappings
| Mapping | Purpose |
|---------|---------|
| `consumedDepositIntents` | Replay protection for deposits |
| `consumedWithdrawIntents` | Replay protection for withdrawals (separate mapping) |
| `intentShares` | Maps intentId to aToken shares received |
| `intentAssets` | Maps intentId to asset address |

### Cross-Chain Message Hashing

**L2→L1 Deposit Message** (256 bytes):
```
sha256_to_field([
    intent_id,        // 32 bytes
    owner_hash,       // 32 bytes
    asset,            // 32 bytes (L1 address as Field)
    net_amount,       // 32 bytes
    original_decimals,// 32 bytes
    deadline,         // 32 bytes
    salt,             // 32 bytes
    secret_hash       // 32 bytes
])
```

**L1→L2 Confirmation Message** (96 bytes):
```
sha256ToField(abi.encodePacked(
    intentId,         // 32 bytes
    asset,            // 32 bytes (address padded)
    shares            // 32 bytes
))
```

Note: The secretHash is passed as a separate parameter to `sendL2Message`, not included in the content hash.

## Resolved Questions

1. **Burn proof mechanism**: Standard Aztec L2→L1 message consumption. The L1 portal consumes the message from the Aztec outbox, which proves the L2 transaction (including the burn) was included in a proven L2 block.

2. **Fee recipient**: Fees go to `fee_treasury` address set during AaveWrapper initialization. The treasury is an L2 address that receives the 0.1% fee via BridgedToken.transfer_from.

3. **Cancel verification**: Uses L2 public state:
   - `intent_status` must be PENDING_DEPOSIT
   - `consumed_intents` must be false
   - `intent_owners` must match caller
   - `current_time > intent_deadlines[intentId]`

4. **Minimum deposit**: Set to 1 USDC (1,000,000 base units with 6 decimals) to ensure meaningful deposits and non-zero fees.

## Out of Scope (MVP)

- Multi-asset support (USDC only)
- Dynamic fee based on gas prices
- Relayer marketplace/competition
- Partial withdrawals
- L2 token swaps before deposit
- Privacy set analysis/recommendations

## Deployed Contracts

| Contract | Layer | Purpose |
|----------|-------|---------|
| MockUSDC | L1 | Test ERC20 token |
| TokenPortal | L1 | L1↔L2 token bridge (holds L1 USDC) |
| AztecAavePortalL1 | L1 | Aave integration, message consumption |
| BridgedToken | L2 | L2 representation of bridged USDC |
| AaveWrapper | L2 | Privacy-preserving deposit/withdraw orchestration |
