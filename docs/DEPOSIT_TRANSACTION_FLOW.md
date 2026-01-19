# Deposit Transaction Flow

This document details every transaction signed during the deposit flow in the Aztec Aave Wrapper frontend.

## Transaction Summary

| # | Chain | TX Type | Signer | Function | Description |
|---|-------|---------|--------|----------|-------------|
| Prerequisite | L1/L2 | Bridge USDC | User | TokenPortal + L2Token | One-time bridge to L2 (can be done in advance) |
| 1 | L2 | Request Deposit | User (Azguard) | `request_deposit()` | Burns L2 tokens, creates intent |
| 2 | L1 | Execute Deposit | Anyone | `executeDeposit()` | Claims from bridge, supplies to Aave |
| 3 | L2 | Finalize Deposit | User (Azguard) | `finalize_deposit()` | Creates position receipt |

---

## ASCII Transaction Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                    PRIVACY-PRESERVING DEPOSIT FLOW                                       │
└─────────────────────────────────────────────────────────────────────────────────────────┘

PREREQUISITE (Separate Flow - can be done days/weeks earlier):
══════════════════════════════════════════════════════════════
User bridges USDC from L1 to L2 via TokenPortal
  │
  ├── TX A: User approves TokenPortal for USDC (L1 - MetaMask)
  ├── TX B: User calls TokenPortal.depositToAztecPrivate() (L1 - MetaMask)
  │         └── Tokens held by TokenPortal on L1
  └── TX C: User claims L2 USDC via L2 Token contract (L2 - Azguard)
            └── User now has private L2 USDC balance

═══════════════════════════════════════════════════════════════════════════════════════════

User clicks "Deposit to Aave" button
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 0: Generate Secret Pair (no signature)                                            │
│  - Generates secret + secretHash for privacy                                            │
└─────────────────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
╔═════════════════════════════════════════════════════════════════════════════════════════╗
║  TX #1: REQUEST DEPOSIT (L2 - Aztec)                                                    ║
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║  Signer:    User via Azguard Wallet                                                     ║
║  Contract:  AaveWrapper (L2)                                                            ║
║  Function:  request_deposit(asset, amount, deadline, secret_hash)                       ║
║                                                                                         ║
║  State Changes:                                                                         ║
║  ├── BURNS user's L2 USDC tokens (privacy-preserving)                                   ║
║  ├── Creates DepositIntent with unique intentId                                         ║
║  ├── Stores intent_owners[intentId] = caller (L2 private state)                         ║
║  ├── Computes ownerHash = Poseidon(userL2Address) for privacy                           ║
║  └── Sends L2→L1 message to Aztec outbox                                                ║
╚═════════════════════════════════════════════════════════════════════════════════════════╝
         │
         │  L2 → L1 Message (async, ~2 blocks)
         │  Contains: intentId, ownerHash, asset, amount, deadline, salt, secretHash
         ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  WAIT: Poll for L2→L1 message availability                                              │
│  - Fetches L2→L1 message proof from Aztec node                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
╔═════════════════════════════════════════════════════════════════════════════════════════╗
║  TX #2: EXECUTE DEPOSIT (L1 - Ethereum)                                                 ║
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║  Signer:    Anyone (relayer or user from fresh wallet - preserves privacy)              ║
║  Contract:  AztecAavePortalL1                                                           ║
║  Function:  executeDeposit(intent, l2BlockNumber, leafIndex, siblingPath)               ║
║                                                                                         ║
║  State Changes:                                                                         ║
║  ├── Consumes L2→L1 message from Aztec outbox                                           ║
║  ├── Verifies message proof against outbox Merkle tree                                  ║
║  ├── Claims tokens from TokenPortal (authorized by L2 burn)                             ║
║  ├── Calls Aave LendingPool.supply(asset, amount, portal, 0)                            ║
║  ├── Portal receives aTokens (shares)                                                   ║
║  ├── intentShares[intentId] = receivedShares                                            ║
║  ├── intentAssets[intentId] = assetAddress                                              ║
║  ├── Sends L1→L2 message via Aztec inbox                                                ║
║  └── Emits L2MessageSent(messageLeaf, messageIndex)                                     ║
╚═════════════════════════════════════════════════════════════════════════════════════════╝
         │
         │  L1 → L2 Message (async, ~10 blocks)
         │  Contains: intentId, asset, shares, secretHash
         ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  WAIT: Poll for L1→L2 message availability                                              │
│  - Waits for message to be consumable on L2                                             │
│  - Fetches membership witness proof                                                     │
└─────────────────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
╔═════════════════════════════════════════════════════════════════════════════════════════╗
║  TX #3: FINALIZE DEPOSIT (L2 - Aztec)                                                   ║
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║  Signer:    User via Azguard Wallet                                                     ║
║  Contract:  AaveWrapper (L2)                                                            ║
║  Function:  finalize_deposit(intentId, asset, shares, secret, messageLeafIndex)         ║
║                                                                                         ║
║  State Changes:                                                                         ║
║  ├── Consumes L1→L2 message from Aztec inbox                                            ║
║  ├── Verifies caller owns the intent via intent_owners mapping                          ║
║  ├── Creates PositionReceiptNote (encrypted private note)                               ║
║  │   └── Contains: owner, intentId, asset, shares                                       ║
║  ├── Note stored in user's private state (PXE)                                          ║
║  └── Removes intentId from intent_owners                                                ║
╚═════════════════════════════════════════════════════════════════════════════════════════╝
         │
         ▼
    ┌─────────┐
    │  DONE   │
    └─────────┘
```

---

## Token Flow Diagram

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
│   DEPOSIT PHASE (privacy-preserving):                                       │
│   ══════════════════════════════════                                        │
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

---

## Smart Contract Functions

### Prerequisite: Bridge USDC to L2

Before depositing to Aave, users must first bridge USDC from L1 to L2. This is a standard Aztec bridge operation using the TokenPortal.

**TX A: Approve TokenPortal (L1)**
```solidity
IERC20(usdc).approve(tokenPortalAddress, amount)
```

**TX B: Deposit to Aztec (L1)**
```solidity
TokenPortal.depositToAztecPrivate(
    secretHashForL2MessageConsumption,
    amount,
    secretHashForRedeemingMintedNotes
)
```

**TX C: Claim L2 Tokens (L2)**
```noir
L2Token.claim_private(
    secret_for_L1_to_L2_message_consumption,
    amount,
    secret_for_redeeming_minted_notes
)
```

**Result**: User has private L2 USDC balance that can be used for Aave deposits.

---

### TX #1: request_deposit (L2 Noir)

**Contract**: `AaveWrapper (L2)`

```noir
#[external("private")]
fn request_deposit(
    asset: Field,
    amount: u128,
    original_decimals: u8,
    deadline: u64,
    secret_hash: Field,
) -> pub Field {
    // Get caller address for intent binding (kept private)
    let caller = self.msg_sender().unwrap();

    // Validate amount is non-zero
    assert(amount > 0, "Amount must be greater than zero");

    // Validate deadline bounds
    assert(deadline > 0, "Deadline must be greater than zero");

    // BURN user's L2 tokens (privacy-preserving - no L1 transfer needed)
    L2Token::at(bridged_token_address).burn(caller, amount);

    // Compute hash of owner for privacy
    let owner_hash = poseidon2_hash([caller.to_field()]);

    // Generate salt from a hash of caller + secret_hash for uniqueness
    let salt = poseidon2_hash([caller.to_field(), secret_hash]);

    // Compute unique intent_id using poseidon2 hash of all inputs
    let intent_id = compute_intent_id(caller, asset, amount, original_decimals, deadline, salt);

    // Create the deposit intent struct for L2 to L1 message
    let intent = DepositIntent::new(
        intent_id, owner_hash, asset, amount, original_decimals, deadline, salt,
    );

    // Compute the message content hash for L2 to L1 messaging
    let content = compute_deposit_message_content(intent, secret_hash);

    // Send L2 to L1 message to the portal contract
    let portal = self.storage.portal_address.read();
    self.context.message_portal(portal, content);

    // Enqueue public call to update intent status and store owner mapping
    AaveWrapper::at(self.context.this_address())
        ._set_intent_pending_deposit(intent_id, caller)
        .enqueue(self.context);

    intent_id
}
```

**State Changes**:
| Storage | Before | After |
|---------|--------|-------|
| User L2 Token balance | `X` | `X - amount` (burned) |
| `intent_owners[intentId]` | `0x0` | `caller` |
| `intent_status[intentId]` | `0 (UNKNOWN)` | `1 (PENDING_DEPOSIT)` |
| `consumed_intents[intentId]` | `false` | `false` |

---

### TX #2: executeDeposit (L1 Solidity)

**Contract**: `AztecAavePortalL1`

```solidity
function executeDeposit(
    DepositIntent calldata intent,
    uint256 l2BlockNumber,
    uint256 leafIndex,
    bytes32[] calldata siblingPath
) external whenNotPaused {
    // Step 1: Check for replay attack first (cheapest check)
    if (consumedIntents[intent.intentId]) {
        revert IntentAlreadyConsumed(intent.intentId);
    }

    // Step 2: Check deadline hasn't passed
    if (block.timestamp >= intent.deadline) {
        revert DeadlinePassed();
    }

    // Step 3: Validate deadline is within acceptable bounds
    _validateDeadline(intent.deadline);

    // Step 4: Compute message content (intent hash) for outbox consumption
    bytes32 intentHash = IntentLib.hashDepositIntent(intent);

    // Step 5: Construct L2ToL1Msg and consume from Aztec outbox
    DataStructures.L2ToL1Msg memory outboxMessage = DataStructures.L2ToL1Msg({
        sender: DataStructures.L2Actor({
            actor: l2ContractAddress,
            version: aztecVersion
        }),
        recipient: DataStructures.L1Actor({
            actor: address(this),
            chainId: block.chainid
        }),
        content: intentHash
    });
    IAztecOutbox(aztecOutbox).consume(outboxMessage, l2BlockNumber, leafIndex, siblingPath);

    // Step 6: Mark intent as consumed for replay protection
    consumedIntents[intent.intentId] = true;

    // Step 7: Claim tokens from TokenPortal (authorized by L2 burn)
    ITokenPortal(tokenPortal).withdraw(intent.asset, intent.amount, address(this), true);

    // Step 8: Get aToken balance before supply
    address aToken = _getATokenAddress(intent.asset);
    uint256 aTokenBalanceBefore = IERC20(aToken).balanceOf(address(this));

    // Step 9: Approve Aave pool to spend tokens
    bool approveSuccess = IERC20(intent.asset).approve(aavePool, intent.amount);
    require(approveSuccess, "Token approval failed");

    // Step 10: Supply tokens to Aave (this contract receives aTokens)
    ILendingPool(aavePool).supply(
        intent.asset,
        intent.amount,
        address(this), // aTokens go to this contract
        0 // referral code
    );

    // Step 11: Calculate shares received (aToken balance difference)
    uint256 aTokenBalanceAfter = IERC20(aToken).balanceOf(address(this));
    uint128 shares = uint128(aTokenBalanceAfter - aTokenBalanceBefore);

    if (shares == 0) {
        revert AaveSupplyFailed();
    }

    // Step 12: Store shares for this intent (for withdrawal tracking)
    intentShares[intent.intentId] = shares;
    intentAssets[intent.intentId] = intent.asset;

    emit DepositExecuted(intent.intentId, intent.asset, intent.amount, shares);

    // Step 13: Send L1->L2 confirmation message
    bytes32 messageContent = _computeDepositFinalizationMessage(
        intent.intentId, intent.ownerHash, ConfirmationStatus.SUCCESS, shares, intent.asset
    );

    DataStructures.L2Actor memory recipient = DataStructures.L2Actor({
        actor: l2ContractAddress,
        version: aztecVersion
    });
    (bytes32 messageLeaf, uint256 messageIndex) =
        IAztecInbox(aztecInbox).sendL2Message(recipient, messageContent, intent.secretHash);

    emit DepositConfirmed(intent.intentId, shares, ConfirmationStatus.SUCCESS);
    emit L2MessageSent(intent.intentId, messageLeaf, messageIndex);
}
```

**DepositIntent Struct** (`eth/contracts/types/Intent.sol`):
```solidity
struct DepositIntent {
    bytes32 intentId;
    bytes32 ownerHash;
    address asset;
    uint128 amount;
    uint8 originalDecimals;
    uint64 deadline;
    bytes32 salt;
    bytes32 secretHash;
}
```

**State Changes**:
| Storage | Before | After |
|---------|--------|-------|
| `consumedIntents[intentId]` | `false` | `true` |
| `intentShares[intentId]` | `0` | `shares` |
| `intentAssets[intentId]` | `0x0` | `asset` |
| TokenPortal USDC balance | `X` | `X - amount` |
| Aave `aToken.balanceOf(portal)` | `Y` | `Y + shares` |

---

### TX #3: finalize_deposit (L2 Noir)

**Contract**: `AaveWrapper (L2)`

```noir
#[external("private")]
fn finalize_deposit(
    intent_id: Field,
    asset_id: Field,
    shares: u128,
    secret: Field,
    message_leaf_index: Field,
) {
    // Get the caller's address (the owner of the new position receipt)
    let owner = self.msg_sender().unwrap();

    // Compute the expected message content hash
    // This must match exactly what the L1 portal sent
    let content = compute_deposit_confirmation_content(intent_id, asset_id, shares);

    // Get the portal address for message verification
    let portal = self.storage.portal_address.read();

    // Consume the L1->L2 message
    // This will:
    // - Verify the message exists in the L1->L2 tree
    // - Verify the secret hashes to the expected secretHash
    // - Emit a nullifier to prevent double-consumption
    // - Revert if the message doesn't exist or secret is wrong
    self.context.consume_l1_to_l2_message(content, secret, portal, message_leaf_index);

    // Generate a unique nonce for the note using the intent_id
    let note_nonce = intent_id;

    // Create the position receipt note with Active status
    let receipt = PositionReceiptNote {
        owner,
        nonce: note_nonce,
        asset_id,
        shares,
        aave_market_id: 0,
        status: PositionStatus::ACTIVE,
    };

    // Insert the note into the private receipts set
    self.storage.receipts.at(owner).insert(receipt).deliver(MessageDelivery.CONSTRAINED_ONCHAIN);

    // Enqueue public call to mark intent as consumed
    AaveWrapper::at(self.context.this_address())._finalize_deposit_public(intent_id).enqueue(
        self.context,
    );
}
```

**PositionReceiptNote Struct** (`aztec/src/types/position_receipt.nr`):
```noir
struct PositionReceiptNote {
    owner: AztecAddress,
    nonce: Field,
    asset_id: Field,
    shares: u128,
    aave_market_id: Field,
    status: u8,
}
```

**State Changes**:
| Storage | Before | After |
|---------|--------|-------|
| `intent_status[intentId]` | `1 (PENDING_DEPOSIT)` | `2 (CONFIRMED)` |
| `consumed_intents[intentId]` | `false` | `true` |
| `intent_owners[intentId]` | `caller` | `0x0` |
| `receipts` (private) | - | New `PositionReceiptNote` added |

---

## Privacy Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         PRIVACY FLOW                                      │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   L2 (Aztec - Private)              L1 (Ethereum - Public)               │
│   ════════════════════              ═══════════════════════              │
│                                                                          │
│   User Address: 0xABC...            ownerHash: hash(0xABC...)            │
│         │                                     │                          │
│         │                                     │ Never reveals            │
│         ▼                                     │ actual address           │
│   L2 Token Balance                            ▼                          │
│         │                           TokenPortal holds USDC               │
│         │ burn                                │                          │
│         ▼                                     │ claim (no user link)     │
│   intent_owners[id] = 0xABC                   ▼                          │
│         │                           intentShares[id] = shares            │
│         │                                     │                          │
│         │                                     │ Anyone can execute       │
│         ▼                                     │ (not user wallet)        │
│   PositionReceiptNote                         ▼                          │
│   (encrypted, private)              aTokens held by portal               │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Key Privacy Features**:
1. **L2 Token Burn**: User's L2 tokens are burned privately - no L1 transfer from user wallet
2. `ownerHash = poseidon2_hash([userL2Address])` - L1 never sees actual L2 address
3. **Anyone-can-execute**: TX #2 can be executed by anyone - user's L1 wallet not linked to portal
4. **TokenPortal claim**: Tokens come from TokenPortal, not from user's L1 wallet
5. `PositionReceiptNote` is encrypted - Only owner can read position data
6. Public events emit only `intentId` - No user-identifying information

---

## Wallet Interactions Summary

| Wallet | Transactions Signed | When |
|--------|---------------------|------|
| MetaMask (L1) | Prerequisite: Approve + Deposit to TokenPortal | One-time bridge (can be done in advance) |
| Azguard (L2) | Prerequisite: Claim L2 tokens | After bridge |
| Azguard (L2) | TX #1 (Request) | Start of deposit flow |
| Anyone (L1) | TX #2 (Execute) | After L2→L1 message ready |
| Azguard (L2) | TX #3 (Finalize) | End of deposit flow |

---

## Error Handling

If any transaction fails, the flow stops at that step:
- **Prerequisite fails**: No state changed on L2, user can retry bridge
- **TX #1 fails**: No tokens burned, no intent created - user can retry
- **TX #2 fails**: Intent queued in portal retry queue, retryable by anyone later
- **TX #2 deadline expires**: User can call `cancel_deposit()` to reclaim tokens on L2
- **TX #3 fails**: Shares on L1, message exists - can retry finalization

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
         ├── Verify intent not consumed on L1
         ├── Mint L2 tokens back to user
         └── Mark intent as cancelled
```

---

## Comparison: Old Flow vs New Flow

| Aspect | Old Flow (Removed) | New Flow (Privacy-Preserving) |
|--------|-------------------|-------------------------------|
| Token source | User's L1 wallet | TokenPortal (via L2 burn) |
| L1 transactions by user | 2 (Approve + Transfer) | 0 during deposit |
| Privacy | L1 wallet linked to deposit | L1 wallet never touches portal |
| Prerequisite | None | Bridge USDC to L2 first |
| Execution | Relayer | Anyone (permissionless) |
| Failed deposit recovery | Manual | Timeout + cancel_deposit() |
