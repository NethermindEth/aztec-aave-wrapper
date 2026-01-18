# Withdraw Transaction Flow

This document details every transaction signed during the withdrawal flow in the Aztec Aave Wrapper frontend.

## Transaction Summary

| # | Chain | TX Type | Signer | Function | File | Line |
|---|-------|---------|--------|----------|------|------|
| 1 | L2 | Request Withdraw | User (Azguard) | `request_withdraw()` | operations.ts | 551 |
| 2 | L1 | Execute Withdraw | Relayer | `executeWithdraw()` | portal.ts | 376 |
| 3 | L2 | Finalize Withdraw | User (Azguard) | `finalize_withdraw()` | operations.ts | 626 |

---

## ASCII Transaction Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                          WITHDRAW TRANSACTION FLOW                                       │
└─────────────────────────────────────────────────────────────────────────────────────────┘

User clicks "Withdraw" button (selects position)
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 0: Generate Secret Pair (no signature)                                            │
│  File: frontend/src/flows/withdraw.ts:451                                               │
│  - Generates secret + secretHash for privacy                                            │
│  - Computes ownerHash = poseidon2_hash(userL2Address)                                   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
╔═════════════════════════════════════════════════════════════════════════════════════════╗
║  TX #1: REQUEST WITHDRAW (L2 - Aztec)                                                   ║
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║  Signer:    User via Azguard Wallet                                                     ║
║  Contract:  AaveWrapper (L2)                                                            ║
║  Function:  request_withdraw(nonce, amount, deadline, secret_hash)                      ║
║                                                                                         ║
║  Code Path:                                                                             ║
║  └── withdraw.ts:481-510 → operations.ts:527-584 → SIGN at line 551                     ║
║                                                                                         ║
║  State Changes:                                                                         ║
║  ├── Finds PositionReceiptNote by nonce (original deposit intentId)                     ║
║  ├── Nullifies ACTIVE note, creates PENDING_WITHDRAW note                               ║
║  ├── Computes ownerHash = Poseidon(userL2Address) for privacy                           ║
║  ├── Stores intent_owners[intentId] = caller for finalization routing                   ║
║  ├── Stores intent_deadlines[intentId] = deadline for refund validation                 ║
║  └── Sends L2→L1 message to Aztec outbox                                                ║
╚═════════════════════════════════════════════════════════════════════════════════════════╝
         │
         │  L2 → L1 Message (async, ~2 blocks)
         │  Contains: intentId, ownerHash, amount, deadline, assetId, secretHash
         ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  WAIT: Poll for L2→L1 message availability                                              │
│  File: frontend/src/flows/withdraw.ts:517-524                                           │
│  - Fetches L2→L1 message proof from Aztec node                                          │
│  - Polls up to 30 times with 2-second intervals                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
╔═════════════════════════════════════════════════════════════════════════════════════════╗
║  TX #2: EXECUTE WITHDRAW (L1 - Ethereum)                                                ║
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║  Signer:    Relayer wallet (NOT user - preserves privacy)                               ║
║  Contract:  AztecAavePortalL1                                                           ║
║  Function:  executeWithdraw(intent, secretHash, l2BlockNumber, leafIndex, siblingPath)  ║
║                                                                                         ║
║  Code Path:                                                                             ║
║  └── withdraw.ts:569-576 → portal.ts:357-388 → SIGN at line 376                         ║
║                                                                                         ║
║  State Changes:                                                                         ║
║  ├── Consumes L2→L1 message from Aztec outbox                                           ║
║  ├── Verifies message proof against outbox Merkle tree                                  ║
║  ├── Calls Aave LendingPool.withdraw(asset, shares, portal)                             ║
║  ├── Clears intentShares[intentId] and intentAssets[intentId]                           ║
║  ├── Approves Token Portal and deposits tokens to L2                                    ║
║  ├── Sends L1→L2 confirmation message via Aztec inbox                                   ║
║  └── Emits L2MessageSent(messageLeaf, messageIndex)                                     ║
╚═════════════════════════════════════════════════════════════════════════════════════════╝
         │
         │  L1 → L2 Message (async, ~10 blocks)
         │  Contains: intentId, asset, withdrawnAmount
         │
         │  Token Portal Message (async)
         │  Contains: amount, secretHash (for private token claim)
         ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  WAIT: Poll for L1→L2 message availability                                              │
│  File: frontend/src/flows/withdraw.ts:588                                               │
│  - Waits for message to be consumable on L2                                             │
│  - Fetches membership witness proof                                                     │
└─────────────────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
╔═════════════════════════════════════════════════════════════════════════════════════════╗
║  TX #3: FINALIZE WITHDRAW (L2 - Aztec)                                                  ║
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║  Signer:    User via Azguard Wallet                                                     ║
║  Contract:  AaveWrapper (L2)                                                            ║
║  Function:  finalize_withdraw(intentId, assetId, amount, secret, messageLeafIndex)      ║
║                                                                                         ║
║  Code Path:                                                                             ║
║  └── withdraw.ts:590-600 → operations.ts:605-639 → SIGN at line 626                     ║
║                                                                                         ║
║  State Changes:                                                                         ║
║  ├── Consumes L1→L2 confirmation message from Aztec inbox                               ║
║  ├── Finds and nullifies PENDING_WITHDRAW PositionReceiptNote                           ║
║  ├── Verifies asset and amount match the L1 confirmation                                ║
║  ├── Updates intent_status[intentId] = CONFIRMED                                        ║
║  ├── Clears intent_owners[intentId] and intent_deadlines[intentId]                      ║
║  └── No new note created (position fully withdrawn)                                     ║
╚═════════════════════════════════════════════════════════════════════════════════════════╝
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  TOKEN CLAIM (separate flow)                                                            │
│  - User claims tokens from Token Portal using secret                                    │
│  - Tokens minted to user's private balance on L2                                        │
└─────────────────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
    ┌─────────┐
    │  DONE   │
    └─────────┘
```

---

## Smart Contract Functions

### TX #1: request_withdraw (L2 Noir)

**Contract**: `aztec/src/main.nr:602-679`

```noir
#[external("private")]
fn request_withdraw(
    nonce: Field,
    amount: u128,
    deadline: u64,
    secret_hash: Field,
) -> pub Field {
    // Get the caller's address (must be the owner of the note)
    let owner = self.msg_sender().unwrap();

    // Use pop_notes with a selector to find the note by nonce
    // The nonce field is at index 1 in the serialized note (after owner)
    // pop_notes() retrieves and nullifies notes in one operation
    let options = NoteGetterOptions::new()
        .select(PositionReceiptNote::properties().nonce, Comparator.EQ, nonce)
        .set_limit(1);

    let notes = self.storage.receipts.at(owner).pop_notes(options);

    // Ensure we found exactly one note
    assert(notes.len() == 1, "Position receipt note not found");
    let receipt = notes.get(0);

    // Verify the note is owned by the caller (should always be true due to .at(owner))
    assert(receipt.owner == owner, "Not the owner of this position");

    // Verify the receipt status is Active
    assert(receipt.status == PositionStatus::ACTIVE, "Position is not active");

    // MVP: Enforce full withdrawal only (no partial withdrawals)
    assert(
        amount == receipt.shares,
        "Must withdraw full position (partial withdrawals not supported)",
    );

    // The intent_id for withdrawal is the note's nonce (same as the original deposit intent_id)
    let intent_id = receipt.nonce;

    // Create a new note with PendingWithdraw status
    let pending_receipt = PositionReceiptNote {
        owner,
        nonce: receipt.nonce,
        asset_id: receipt.asset_id,
        shares: amount, // Store withdrawal amount for validation in finalize_withdraw
        aave_market_id: receipt.aave_market_id,
        status: PositionStatus::PENDING_WITHDRAW,
    };

    // Insert the pending withdrawal note
    self.storage.receipts.at(owner).insert(pending_receipt).deliver(
        MessageDelivery.CONSTRAINED_ONCHAIN,
    );

    // Compute hash of owner for privacy
    let owner_hash = poseidon2_hash([owner.to_field()]);

    // Create the withdraw intent for L2 to L1 message
    let intent = WithdrawIntent::new(intent_id, owner_hash, amount, deadline);

    // Compute the message content hash for L2 to L1 messaging
    let content = compute_withdraw_message_content(intent, receipt.asset_id, secret_hash);

    // Send L2 to L1 message to the portal contract
    let portal = self.storage.portal_address.read();
    self.context.message_portal(portal, content);

    // Enqueue public call to update intent status and store owner mapping
    AaveWrapper::at(self.context.this_address())
        ._request_withdraw_public(intent_id, owner, deadline)
        .enqueue(self.context);

    intent_id
}
```

**State Changes**:
| Storage | Before | After |
|---------|--------|-------|
| `receipts` (private) | `PositionReceiptNote` with `status=ACTIVE` | Note nullified |
| `receipts` (private) | - | New `PositionReceiptNote` with `status=PENDING_WITHDRAW` |
| `intent_status[intentId]` | `2 (CONFIRMED)` | `4 (PENDING_WITHDRAW)` |
| `intent_owners[intentId]` | `0x0` | `caller` |
| `intent_deadlines[intentId]` | `0` | `deadline` |

---

### TX #2: executeWithdraw (L1 Solidity)

**Contract**: `eth/contracts/AztecAavePortalL1.sol:289-386`

```solidity
function executeWithdraw(
    WithdrawIntent calldata intent,
    bytes32 secretHash,
    uint256 l2BlockNumber,
    uint256 leafIndex,
    bytes32[] calldata siblingPath
) external whenNotPaused {
    // Step 1: Check for replay attack first
    if (consumedIntents[intent.intentId]) {
        revert IntentAlreadyConsumed(intent.intentId);
    }

    // Step 2: Check deadline hasn't passed
    if (block.timestamp >= intent.deadline) {
        revert DeadlinePassed();
    }

    // Step 3: Validate deadline is within acceptable bounds
    _validateDeadline(intent.deadline);

    // Step 4: Check we have shares for this intent
    uint128 shares = intentShares[intent.intentId];
    if (shares == 0) {
        revert NoSharesForIntent(intent.intentId);
    }

    address asset = intentAssets[intent.intentId];

    // Step 5: Compute message content (intent hash) for outbox consumption
    bytes32 intentHash = IntentLib.hashWithdrawIntent(intent);

    // Step 6: Construct L2ToL1Msg and consume from Aztec outbox
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

    // Step 7: Mark intent as consumed for replay protection
    consumedIntents[intent.intentId] = true;

    // Step 8: Clear shares for this intent (full withdrawal)
    delete intentShares[intent.intentId];
    delete intentAssets[intent.intentId];

    // Step 9: Withdraw from Aave (withdraw full aToken balance for this intent)
    uint256 withdrawnAmount = ILendingPool(aavePool).withdraw(
        asset,
        shares, // Withdraw the shares we tracked
        address(this)
    );

    if (withdrawnAmount == 0) {
        revert AaveWithdrawFailed();
    }

    emit WithdrawExecuted(intent.intentId, asset, withdrawnAmount);

    // Step 10: Approve token portal and deposit to L2
    IERC20(asset).approve(tokenPortal, 0);
    bool approveSuccess = IERC20(asset).approve(tokenPortal, withdrawnAmount);
    if (!approveSuccess) {
        revert TokenTransferFailed();
    }

    (bytes32 messageKey, uint256 messageIndex) =
        ITokenPortal(tokenPortal).depositToAztecPrivate(withdrawnAmount, secretHash);

    emit TokensDepositedToL2(intent.intentId, messageKey, messageIndex);

    // Step 11: Send L1->L2 confirmation message
    bytes32 messageContent = _computeWithdrawFinalizationMessage(
        intent.intentId,
        intent.ownerHash,
        ConfirmationStatus.SUCCESS,
        uint128(withdrawnAmount),
        asset
    );

    // Construct L2 recipient and send message
    DataStructures.L2Actor memory recipient = DataStructures.L2Actor({
        actor: l2ContractAddress,
        version: aztecVersion
    });
    (bytes32 messageLeaf, uint256 confirmationMessageIndex) =
        IAztecInbox(aztecInbox).sendL2Message(recipient, messageContent, bytes32(0));

    emit WithdrawConfirmed(intent.intentId, withdrawnAmount, ConfirmationStatus.SUCCESS);
    emit L2MessageSent(intent.intentId, messageLeaf, confirmationMessageIndex);
}
```

**WithdrawIntent Struct** (`eth/contracts/types/Intent.sol`):
```solidity
struct WithdrawIntent {
    bytes32 intentId;
    bytes32 ownerHash;
    uint128 amount;
    uint64 deadline;
}
```

**State Changes**:
| Storage | Before | After |
|---------|--------|-------|
| `consumedIntents[intentId]` | `false` | `true` |
| `intentShares[intentId]` | `shares` | `0` (deleted) |
| `intentAssets[intentId]` | `asset` | `0x0` (deleted) |
| Aave `aToken.balanceOf(portal)` | `X` | `X - shares` |
| USDC `balances[portal]` | `Y` | `Y + withdrawnAmount` |
| Token Portal | - | Tokens deposited for L2 claim |

---

### TX #3: finalize_withdraw (L2 Noir)

**Contract**: `aztec/src/main.nr:744-808`

```noir
#[external("private")]
fn finalize_withdraw(
    intent_id: Field,
    asset_id: Field,
    amount: u128,
    secret: Field,
    message_leaf_index: Field,
) {
    // Get the caller's address (must be the owner of the pending withdraw note)
    let owner = self.msg_sender().unwrap();

    // Compute the expected message content hash
    // This must match exactly what the L1 portal sent
    // Note: owner is NOT in the hash - authentication is via the secret
    let content = compute_withdraw_confirmation_content(intent_id, asset_id, amount);

    // Get the portal address for message verification
    let portal = self.storage.portal_address.read();

    // Consume the L1->L2 message
    // This will:
    // - Verify the message exists in the L1->L2 tree
    // - Verify the secret hashes to the expected secretHash
    // - Emit a nullifier to prevent double-consumption
    // - Revert if the message doesn't exist or secret is wrong
    self.context.consume_l1_to_l2_message(content, secret, portal, message_leaf_index);

    // Find and nullify the PendingWithdraw receipt note
    // Use pop_notes with a selector to find the note by nonce (which equals intent_id)
    let options = NoteGetterOptions::new()
        .select(PositionReceiptNote::properties().nonce, Comparator.EQ, intent_id)
        .set_limit(1);

    let notes = self.storage.receipts.at(owner).pop_notes(options);

    // Ensure we found exactly one note
    assert(notes.len() == 1, "Pending withdraw receipt note not found");
    let receipt = notes.get(0);

    // Verify the note is owned by the caller
    assert(receipt.owner == owner, "Not the owner of this position");

    // Verify the receipt status is PendingWithdraw
    assert(
        receipt.status == PositionStatus::PENDING_WITHDRAW,
        "Position is not pending withdrawal",
    );

    // Verify the asset matches
    assert(receipt.asset_id == asset_id, "Asset ID mismatch");

    // Verify the withdrawal amount matches what was requested
    assert(receipt.shares == amount, "Withdrawal amount mismatch");

    // Note is already nullified by pop_notes above
    // No new note is created since this is a full withdrawal

    // Enqueue public call to mark intent as consumed
    AaveWrapper::at(self.context.this_address())._finalize_withdraw_public(intent_id).enqueue(
        self.context,
    );
}
```

**State Changes**:
| Storage | Before | After |
|---------|--------|-------|
| `receipts` (private) | `PositionReceiptNote` with `status=PENDING_WITHDRAW` | Note nullified (deleted) |
| `intent_status[intentId]` | `4 (PENDING_WITHDRAW)` | `2 (CONFIRMED)` |
| `consumed_intents[intentId]` | `true` | `true` (unchanged) |
| `intent_owners[intentId]` | `caller` | `0x0` |
| `intent_deadlines[intentId]` | `deadline` | `0` |

---

## Detailed Transaction Breakdown

### TX #1: Request Withdraw (L2)

**Entry Point**: `WithdrawFlow.tsx:166` → `App.tsx:257` → `withdraw.ts:419`

**Code References**:
```
frontend/src/flows/withdraw.ts:481-510        # Flow orchestration
frontend/src/services/l2/operations.ts:527-584   # Contract call construction
frontend/src/services/l2/operations.ts:551       # Actual signing point
```

**What Gets Signed**:
- Aztec transaction calling `request_withdraw` on AaveWrapper contract
- Fee payment via SponsoredFPC (gas-less for user)

**Parameters**:
```
nonce = position.depositIntentId  // Original deposit's intentId
amount = position.shares          // Full withdrawal required (MVP)
deadline = l1Timestamp + 3600     // 1 hour from now
secretHash = hash(secret)         // For L1→L2 message claim
```

---

### TX #2: Execute Withdraw (L1)

**Code References**:
```
frontend/src/flows/withdraw.ts:569-576     # Flow trigger
frontend/src/services/l1/portal.ts:357-388    # Execute implementation
frontend/src/services/l1/portal.ts:376        # Actual signing point
```

**Signer**: Relayer wallet (hardcoded in `DevnetAccounts.relayer`)
- This is intentional for privacy - user identity not linked to L1 execution

**What Gets Signed (Relayer)**:
```solidity
AztecAavePortalL1.executeWithdraw(
    intent,           // WithdrawIntent struct
    secretHash,       // For token portal deposit
    l2BlockNumber,    // For proof verification
    leafIndex,        // Message position in tree
    siblingPath       // Merkle proof
)
```

**Key Actions**:
1. Consumes L2→L1 message from Aztec outbox
2. Withdraws tokens from Aave (converts aTokens → underlying)
3. Deposits tokens to Aztec Token Portal (for private claim on L2)
4. Sends L1→L2 confirmation message

---

### TX #3: Finalize Withdraw (L2)

**Code References**:
```
frontend/src/flows/withdraw.ts:590-600     # Flow orchestration
frontend/src/services/l2/operations.ts:605-639  # Contract call construction
frontend/src/services/l2/operations.ts:626      # Actual signing point
```

**What Gets Signed**:
- Aztec transaction calling `finalize_withdraw` on AaveWrapper contract
- Fee payment via SponsoredFPC

**Note**: This transaction may fail in devnet without real L1→L2 messaging infrastructure

---

## Privacy Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                      WITHDRAWAL PRIVACY FLOW                              │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   L2 (Aztec - Private)              L1 (Ethereum - Public)               │
│   ════════════════════              ═══════════════════════              │
│                                                                          │
│   User owns PositionReceiptNote     ownerHash: hash(user)                │
│   (encrypted, only user can see)          │                              │
│         │                                 │ Never reveals                │
│         │                                 │ actual address               │
│         ▼                                 ▼                              │
│   request_withdraw()               executeWithdraw()                     │
│   - Nullifies ACTIVE note          - Relayer signs (not user)            │
│   - Creates PENDING_WITHDRAW       - Withdraws from Aave                 │
│         │                          - Deposits to Token Portal            │
│         │                                 │                              │
│         ▼                                 │ secretHash binds             │
│   finalize_withdraw()                     │ tokens to user               │
│   - Consumes L1→L2 message               ▼                              │
│   - Nullifies PENDING note         Tokens deposited privately            │
│   - Position fully closed          (user claims with secret)             │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Key Privacy Features**:
1. `ownerHash = poseidon2_hash([userL2Address])` - L1 never sees actual L2 address
2. Relayer signs TX #2 - User's wallet address not linked to L1 execution
3. Token Portal uses `secretHash` - Only user who knows secret can claim tokens
4. `PositionReceiptNote` is encrypted - Position data private to owner

---

## Wallet Interactions Summary

| Wallet | Transactions Signed | When |
|--------|---------------------|------|
| Azguard (L2) | TX #1 (Request), TX #3 (Finalize) | Start and end of flow |
| Relayer (L1) | TX #2 (Execute) | After L2→L1 message ready |

**Note**: Unlike deposit, user does NOT sign any MetaMask transactions during withdrawal.
The relayer handles all L1 interactions.

---

## MVP Constraints

**Full Withdrawal Only** (`aztec/src/main.nr:631-635`):
```noir
// MVP: Enforce full withdrawal only (no partial withdrawals)
assert(
    amount == receipt.shares,
    "Must withdraw full position (partial withdrawals not supported)",
);
```

This simplifies the note lifecycle - no need to track partial positions.

---

## Refund Flow (Expired Withdrawals)

If a withdrawal request expires (deadline passes without L1 execution), users can claim a refund:

**Contract**: `aztec/src/main.nr:872-929`

```noir
#[external("private")]
fn claim_refund(nonce: Field, current_time: u64) {
    // Find and nullify PENDING_WITHDRAW note
    // Create new ACTIVE note with same position details (different nonce)
    // Enqueue public call to verify deadline expired and reset status
}
```

**State Changes**:
| Storage | Before | After |
|---------|--------|-------|
| `receipts` (private) | `PENDING_WITHDRAW` note | Nullified |
| `receipts` (private) | - | New `ACTIVE` note (different nonce) |
| `intent_status[intentId]` | `4 (PENDING_WITHDRAW)` | `2 (CONFIRMED)` |
| `intent_owners[intentId]` | `caller` | `0x0` |

---

## Error Handling

If any transaction fails, the flow stops at that step:
- **TX #1 fails**: No state changed (note not nullified), user can retry
- **TX #2 fails**: L2 note is PENDING_WITHDRAW, user can:
  - Wait and retry L1 execution
  - Claim refund after deadline expires
- **TX #3 fails**: L1 already executed, tokens in portal - can retry finalization

**Error Detection** (`withdraw.ts:639-650`):
- User rejection errors (user cancelled)
- Network errors (RPC issues)
- Timeout errors (message not found)
- Position not found errors

**Automatic Retry** (`withdraw.ts:669-704`):
- `executeWithdrawFlowWithRetry()` provides automatic retry
- Excludes permanent failures (user rejection, position not found)

---

## Events Emitted

### L1 Events (`AztecAavePortalL1.sol`):
```solidity
event WithdrawExecuted(bytes32 indexed intentId, address indexed asset, uint256 amount);
event WithdrawConfirmed(bytes32 indexed intentId, uint256 amount, ConfirmationStatus status);
event L2MessageSent(bytes32 indexed intentId, bytes32 messageLeaf, uint256 messageIndex);
event TokensDepositedToL2(bytes32 indexed intentId, bytes32 messageKey, uint256 messageIndex);
```

### L2 Events (`main.nr`):
```noir
IntentStatusChangedEvent { intent_id, new_status: PENDING_WITHDRAW }  // After request_withdraw
IntentStatusChangedEvent { intent_id, new_status: CONFIRMED }         // After finalize_withdraw
```
