# Spec: Privacy-Preserving Deposit Flow Redesign

## Summary

Replace the current L1-direct deposit flow with an L2-first flow that preserves user privacy. The current implementation requires users to transfer USDC directly from their L1 wallet to the portal, which links their L1 identity to Aave deposits and defeats the privacy model. The new flow requires users to first bridge USDC to L2, then request Aave deposits from their private L2 balance.

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Token source for deposits | L2 bridged USDC | Breaks link between L1 wallet and Aave position |
| Old L1-direct flow | Remove entirely | No reason to keep non-private path |
| L2 → L1 token movement | Burn on L2, claim from TokenPortal on L1 | Standard Aztec bridge pattern |
| Request atomicity | Single L2 tx | User calls request_deposit which burns tokens + sends L2→L1 message |
| L1 execution | Anyone can execute | Permissionless relay model |
| Relayer compensation | Fixed fee deducted from deposit | Simple, predictable (e.g., 0.1%) |
| Liveness failure handling | Anyone can execute + timeout refund | Dual mechanism for safety |
| Timeout refund source | Mint new L2 tokens | L2 contract authorized to mint if L1 claim never happened |
| Minimum deposit | None | User accepts potential loss on small amounts |
| Token type required | Canonical bridged USDC | Must use TokenPortal-bridged token |
| Bridge implementation | Aztec reference contracts | Use/adapt official token bridge tutorial |

## Requirements

### Must Have
- [ ] Deploy TokenPortal (L1) and L2 Token contract for USDC in local sandbox
- [ ] Modify `request_deposit` to burn L2 tokens instead of expecting L1 transfer
- [ ] Modify `executeDeposit` to claim tokens from TokenPortal instead of expecting portal balance
- [ ] Remove approve+transfer steps (TX #2 and TX #3) from frontend deposit flow
- [ ] Add fee deduction logic (fixed percentage) before Aave supply
- [ ] Implement timeout + refund mechanism for failed L1 executions
- [ ] Update frontend to show separate "Bridge to L2" and "Deposit to Aave" flows

### Must Not
- [ ] User's L1 wallet must NOT interact with AavePortal during deposit (only during initial bridge)
- [ ] L1 events must NOT contain any user-identifying information
- [ ] Relayer must NOT be required (anyone can execute)

## Behavior

### New Deposit Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    NEW PRIVACY-PRESERVING DEPOSIT FLOW                       │
└─────────────────────────────────────────────────────────────────────────────┘

PREREQUISITE (Separate Flow - can be done days/weeks earlier):
══════════════════════════════════════════════════════════════
User bridges USDC from L1 to L2 via TokenPortal
  │
  ├── TX A: User approves TokenPortal for USDC (L1 - MetaMask)
  ├── TX B: User calls TokenPortal.depositToAztecPrivate() (L1 - MetaMask)
  │         └── Tokens held by TokenPortal on L1
  └── TX C: User claims L2 USDC via L2 Token contract (L2 - Azguard)
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
║  Function:  request_deposit(asset, amount, deadline, secret_hash)           ║
║                                                                             ║
║  Actions:                                                                   ║
║  ├── Burn user's L2 USDC tokens (calls L2Token.burn)                        ║
║  ├── Deduct fee (e.g., 0.1%) - fee stays as L2 tokens for relayer           ║
║  ├── Create DepositIntent with net amount                                   ║
║  ├── Store intent_owners[intentId] = caller                                 ║
║  └── Send L2→L1 message to portal                                           ║
╚═════════════════════════════════════════════════════════════════════════════╝
         │
         │  L2 → L1 Message (async, ~2 blocks)
         │  Contains: intentId, ownerHash, asset, netAmount, deadline, secretHash
         ▼
╔═════════════════════════════════════════════════════════════════════════════╗
║  TX #2: EXECUTE DEPOSIT (L1 - Ethereum)                                     ║
╠═════════════════════════════════════════════════════════════════════════════╣
║  Signer:    Anyone (relayer or user from fresh wallet)                      ║
║  Contract:  AztecAavePortalL1                                               ║
║  Function:  executeDeposit(intent, l2BlockNumber, leafIndex, siblingPath)   ║
║                                                                             ║
║  Actions:                                                                   ║
║  ├── Consume L2→L1 message from Aztec outbox                                ║
║  ├── Claim tokens from TokenPortal (L2 burn authorized withdrawal)          ║
║  ├── Supply tokens to Aave V3                                               ║
║  ├── Track intentShares[intentId] = shares                                  ║
║  └── Send L1→L2 confirmation message                                        ║
╚═════════════════════════════════════════════════════════════════════════════╝
         │
         │  L1 → L2 Message (async, ~10 blocks)
         ▼
╔═════════════════════════════════════════════════════════════════════════════╗
║  TX #3: FINALIZE DEPOSIT (L2 - Aztec)                                       ║
╠═════════════════════════════════════════════════════════════════════════════╣
║  Signer:    User via Azguard Wallet                                         ║
║  Contract:  AaveWrapper (L2)                                                ║
║  Function:  finalize_deposit(intentId, asset, shares, secret, leafIndex)    ║
║                                                                             ║
║  Actions:                                                                   ║
║  ├── Consume L1→L2 message                                                  ║
║  ├── Verify caller owns intent                                              ║
║  ├── Create PositionReceiptNote (encrypted)                                 ║
║  └── Clear intent_owners[intentId]                                          ║
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
│   L2: L2Token mints ──L2USDC──► User L2 Balance (private)                   │
│                                                                             │
│   DEPOSIT PHASE (private):                                                  │
│   ════════════════════════                                                  │
│                                                                             │
│   L2: User L2 Balance ──burn──► AaveWrapper (records intent)                │
│                                       │                                     │
│                                       │ L2→L1 message (contains burn proof) │
│                                       ▼                                     │
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
| L1 execution never happens | After deadline, user can call `cancel_deposit()` on L2 to mint tokens back |
| Relayer executes but L1→L2 message fails | User can retry `finalize_deposit()` - message remains consumable |
| User tries to cancel after L1 execution | Cancel fails - intent already consumed on L1 |
| Deposit amount < fee | Transaction reverts (net amount would be 0 or negative) |
| TokenPortal has insufficient L1 reserves | executeDeposit reverts - should not happen if bridge is consistent |
| User double-spends L2 tokens | Impossible - tokens burned atomically in request_deposit |

### Timeout Refund Flow

```
User calls request_deposit()
         │
         ├── L2 tokens burned
         ├── Intent created with deadline
         │
         ▼
    [Deadline passes without L1 execution]
         │
         ▼
User calls cancel_deposit(intentId)
         │
         ├── Verify deadline has passed
         ├── Verify intent not consumed on L1 (check via L1→L2 oracle or proof)
         ├── Mint L2 tokens back to user (minus any penalty?)
         └── Mark intent as cancelled
```

## Technical Notes

### L2 Token Contract Requirements
- Must implement burn functionality callable by AaveWrapper
- Must implement mint functionality callable by AaveWrapper (for refunds)
- Must be the canonical bridged token from TokenPortal
- Use Aztec reference implementation from token bridge tutorial

### L1 Portal Changes
- Remove expectation that tokens are pre-transferred to portal
- Add call to TokenPortal to claim tokens based on L2 burn proof
- TokenPortal must authorize AavePortal to claim burned tokens

### Fee Handling
- Fixed fee percentage (suggest 0.1% = 10 basis points)
- Fee deducted on L2 before burn
- Fee tokens could: stay as L2 tokens, be burned and claimable by protocol, or sent to fee recipient
- Decision: Keep simple for MVP - fee stays as L2 tokens sent to protocol fee address

### Message Content Changes
- L2→L1 deposit message must include proof/authorization for TokenPortal claim
- May need to include burn nonce or similar to prevent replay

### Infrastructure to Deploy (Local Sandbox)
1. USDC ERC20 on L1 (mock)
2. TokenPortal for USDC on L1
3. L2 Token contract for bridged USDC on L2
4. Update AavePortal constructor to reference TokenPortal

## Open Questions

1. **Burn proof mechanism**: How does TokenPortal verify that L2 tokens were actually burned? Need to investigate Aztec's L2→L1 message content and what proofs are available.

2. **Fee recipient**: Where do fees go? Options: L2 protocol treasury address, burned, or claimable by relayers.

3. **Cancel verification**: How does L2 contract verify that L1 execution hasn't happened before allowing cancel? May need L1→L2 state proof or oracle.

4. **Existing positions**: Users with existing positions (from old flow) - how to handle? Likely: old positions continue working, only new deposits use new flow.

## Out of Scope

- Multi-asset support (USDC only for MVP)
- Dynamic fee based on gas prices
- Relayer marketplace/competition
- Partial withdrawals
- L2 token swaps before deposit
- Privacy set analysis/recommendations

## Migration Path

1. Deploy new TokenPortal + L2 Token infrastructure
2. Deploy updated AavePortal with TokenPortal integration
3. Deploy updated L2 AaveWrapper with burn logic
4. Update frontend to use new flow
5. Old positions remain functional (withdrawal path unchanged)
6. Deprecate old deposit documentation
