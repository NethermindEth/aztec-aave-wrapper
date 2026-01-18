# Deposit Transaction Flow

This document details every transaction signed during the deposit flow in the Aztec Aave Wrapper frontend.

## Transaction Summary

| # | Chain | TX Type | Signer | Function | File | Line |
|---|-------|---------|--------|----------|------|------|
| 1 | L2 | Request Deposit | User (Azguard) | `request_deposit()` | operations.ts | 345 |
| 2 | L1 | Approve USDC | User (MetaMask) | `approve()` | tokens.ts | 308 |
| 3 | L1 | Transfer USDC | User (MetaMask) | `transfer()` | tokens.ts | 354 |
| 4 | L1 | Execute Deposit | Relayer | `executeDeposit()` | portal.ts | 262 |
| 5 | L2 | Finalize Deposit | User (Azguard) | `finalize_deposit()` | operations.ts | 441 |

---

## ASCII Transaction Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           DEPOSIT TRANSACTION FLOW                                       │
└─────────────────────────────────────────────────────────────────────────────────────────┘

User clicks "Deposit" button
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 0: Generate Secret Pair (no signature)                                            │
│  File: frontend/src/flows/deposit.ts:414-432                                            │
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
║  Code Path:                                                                             ║
║  └── deposit.ts:437-459 → operations.ts:299-364 → SIGN at line 345                      ║
║                                                                                         ║
║  State Changes:                                                                         ║
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
│  File: frontend/src/flows/deposit.ts:464-471                                            │
│  - Fetches L2→L1 message proof from Aztec node                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
╔═════════════════════════════════════════════════════════════════════════════════════════╗
║  TX #2: APPROVE USDC (L1 - Ethereum)                                                    ║
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║  Signer:    User via MetaMask                                                           ║
║  Contract:  USDC Token (ERC20)                                                          ║
║  Function:  approve(portalAddress, amount)                                              ║
║                                                                                         ║
║  Code Path:                                                                             ║
║  └── deposit.ts:493-501 → tokens.ts:298-320 → SIGN at line 308                          ║
║                                                                                         ║
║  State Changes:                                                                         ║
║  └── allowance[user][portal] = amount                                                   ║
╚═════════════════════════════════════════════════════════════════════════════════════════╝
         │
         ▼
╔═════════════════════════════════════════════════════════════════════════════════════════╗
║  TX #3: TRANSFER USDC (L1 - Ethereum)                                                   ║
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║  Signer:    User via MetaMask                                                           ║
║  Contract:  USDC Token (ERC20)                                                          ║
║  Function:  transfer(portalAddress, amount)                                             ║
║                                                                                         ║
║  Code Path:                                                                             ║
║  └── deposit.ts:504-512 → tokens.ts:344-366 → SIGN at line 354                          ║
║                                                                                         ║
║  State Changes:                                                                         ║
║  ├── balances[user] -= amount                                                           ║
║  └── balances[portal] += amount                                                         ║
╚═════════════════════════════════════════════════════════════════════════════════════════╝
         │
         ▼
╔═════════════════════════════════════════════════════════════════════════════════════════╗
║  TX #4: EXECUTE DEPOSIT (L1 - Ethereum)                                                 ║
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║  Signer:    Relayer wallet (NOT user - preserves privacy)                               ║
║  Contract:  AztecAavePortalL1                                                           ║
║  Function:  executeDeposit(intent, l2BlockNumber, leafIndex, siblingPath)               ║
║                                                                                         ║
║  Code Path:                                                                             ║
║  └── deposit.ts:668-674 → portal.ts:240-325 → SIGN at line 262                          ║
║                                                                                         ║
║  State Changes:                                                                         ║
║  ├── Consumes L2→L1 message from Aztec outbox                                           ║
║  ├── Verifies message proof against outbox Merkle tree                                  ║
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
│  File: frontend/src/flows/deposit.ts:690-698                                            │
│  - Waits for message to be consumable on L2                                             │
│  - Fetches membership witness proof                                                     │
└─────────────────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
╔═════════════════════════════════════════════════════════════════════════════════════════╗
║  TX #5: FINALIZE DEPOSIT (L2 - Aztec)                                                   ║
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║  Signer:    User via Azguard Wallet                                                     ║
║  Contract:  AaveWrapper (L2)                                                            ║
║  Function:  finalize_deposit(intentId, asset, shares, secret, messageLeafIndex)         ║
║                                                                                         ║
║  Code Path:                                                                             ║
║  └── deposit.ts:703-746 → operations.ts:385-454 → SIGN at line 441                      ║
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

## Smart Contract Functions

### TX #1: request_deposit (L2 Noir)

**Contract**: `aztec/src/main.nr:372-430`

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
| `intent_owners[intentId]` | `0x0` | `caller` |
| `intent_status[intentId]` | `0 (UNKNOWN)` | `1 (PENDING_DEPOSIT)` |
| `consumed_intents[intentId]` | `false` | `false` |

---

### TX #2: approve (L1 ERC20)

**Contract**: Standard ERC20 (OpenZeppelin)

```solidity
function approve(address spender, uint256 amount) public returns (bool) {
    _approve(msg.sender, spender, amount);
    return true;
}

function _approve(address owner, address spender, uint256 amount) internal {
    allowances[owner][spender] = amount;
    emit Approval(owner, spender, amount);
}
```

**State Changes**:
| Storage | Before | After |
|---------|--------|-------|
| `allowances[user][portal]` | `0` | `amount` |

---

### TX #3: transfer (L1 ERC20)

**Contract**: Standard ERC20 (OpenZeppelin)

```solidity
function transfer(address to, uint256 amount) public returns (bool) {
    _transfer(msg.sender, to, amount);
    return true;
}

function _transfer(address from, address to, uint256 amount) internal {
    balances[from] -= amount;
    balances[to] += amount;
    emit Transfer(from, to, amount);
}
```

**State Changes**:
| Storage | Before | After |
|---------|--------|-------|
| `balances[user]` | `X` | `X - amount` |
| `balances[portal]` | `Y` | `Y + amount` |

---

### TX #4: executeDeposit (L1 Solidity)

**Contract**: `eth/contracts/AztecAavePortalL1.sol:182-268`

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

    // Step 7: Get aToken balance before supply
    address aToken = _getATokenAddress(intent.asset);
    uint256 aTokenBalanceBefore = IERC20(aToken).balanceOf(address(this));

    // Step 8: Approve Aave pool to spend tokens
    bool approveSuccess = IERC20(intent.asset).approve(aavePool, intent.amount);
    require(approveSuccess, "Token approval failed");

    // Step 9: Supply tokens to Aave (this contract receives aTokens)
    ILendingPool(aavePool).supply(
        intent.asset,
        intent.amount,
        address(this), // aTokens go to this contract
        0 // referral code
    );

    // Step 10: Calculate shares received (aToken balance difference)
    uint256 aTokenBalanceAfter = IERC20(aToken).balanceOf(address(this));
    uint128 shares = uint128(aTokenBalanceAfter - aTokenBalanceBefore);

    if (shares == 0) {
        revert AaveSupplyFailed();
    }

    // Step 11: Store shares for this intent (for withdrawal tracking)
    intentShares[intent.intentId] = shares;
    intentAssets[intent.intentId] = intent.asset;

    emit DepositExecuted(intent.intentId, intent.asset, intent.amount, shares);

    // Step 12: Send L1->L2 confirmation message
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
| Aave `aToken.balanceOf(portal)` | `X` | `X + shares` |
| USDC `balances[portal]` | `Y` | `Y - amount` |

---

### TX #5: finalize_deposit (L2 Noir)

**Contract**: `aztec/src/main.nr:481-531`

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

## Detailed Transaction Breakdown

### TX #1: Request Deposit (L2)

**Entry Point**: `DepositFlow.tsx:241` → `App.tsx:146` → `deposit.ts:393`

**Code References**:
```
frontend/src/flows/deposit.ts:437-459        # Flow orchestration
frontend/src/services/l2/operations.ts:299-364  # Contract call construction
frontend/src/services/l2/operations.ts:345      # Actual signing point
```

**What Gets Signed**:
- Aztec transaction calling `request_deposit` on AaveWrapper contract
- Fee payment via SponsoredFPC (gas-less for user)

**Intent Structure**:
```
intentId = poseidon2_hash([caller, asset, amount, original_decimals, deadline, salt])
ownerHash = poseidon2_hash([caller])  // Privacy: never reveals actual address on L1
salt = poseidon2_hash([caller, secret_hash])  // Ensures uniqueness
```

---

### TX #2: Approve USDC (L1)

**Code References**:
```
frontend/src/flows/deposit.ts:493-501     # Flow trigger
frontend/src/services/l1/tokens.ts:298-320   # Approve implementation
frontend/src/services/l1/tokens.ts:308       # Actual signing point
```

**What Gets Signed (MetaMask)**:
```solidity
IERC20(usdc).approve(portalAddress, amount)
```

---

### TX #3: Transfer USDC (L1)

**Code References**:
```
frontend/src/flows/deposit.ts:504-512     # Flow trigger
frontend/src/services/l1/tokens.ts:344-366   # Transfer implementation
frontend/src/services/l1/tokens.ts:354       # Actual signing point
```

**What Gets Signed (MetaMask)**:
```solidity
IERC20(usdc).transfer(portalAddress, amount)
```

---

### TX #4: Execute Deposit (L1)

**Code References**:
```
frontend/src/flows/deposit.ts:668-674      # Flow trigger
frontend/src/services/l1/portal.ts:240-325    # Execute implementation
frontend/src/services/l1/portal.ts:262        # Actual signing point
```

**Signer**: Relayer wallet (hardcoded in `DevnetAccounts.relayer`)
- This is intentional for privacy - user identity not linked to L1 execution

**What Gets Signed (Relayer)**:
```solidity
AztecAavePortalL1.executeDeposit(
    intent,           // DepositIntent struct
    l2BlockNumber,    // For proof verification
    leafIndex,        // Message position in tree
    siblingPath       // Merkle proof
)
```

---

### TX #5: Finalize Deposit (L2)

**Code References**:
```
frontend/src/flows/deposit.ts:703-746      # Flow orchestration
frontend/src/services/l2/operations.ts:385-454  # Contract call construction
frontend/src/services/l2/operations.ts:441      # Actual signing point
```

**What Gets Signed**:
- Aztec transaction calling `finalize_deposit` on AaveWrapper contract
- Fee payment via SponsoredFPC

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
│   intent_owners[id] = 0xABC                   ▼                          │
│         │                           intentShares[id] = shares            │
│         │                                     │                          │
│         │                                     │ Relayer executes         │
│         ▼                                     │ (not user wallet)        │
│   PositionReceiptNote                         ▼                          │
│   (encrypted, private)              aTokens held by portal               │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Key Privacy Features**:
1. `ownerHash = poseidon2_hash([userL2Address])` - L1 never sees actual L2 address
2. Relayer signs TX #4 - User's MetaMask address not linked to portal execution
3. `PositionReceiptNote` is encrypted - Only owner can read position data
4. Public events emit only `intentId` - No user-identifying information

---

## Wallet Interactions Summary

| Wallet | Transactions Signed | When |
|--------|---------------------|------|
| Azguard (L2) | TX #1 (Request), TX #5 (Finalize) | Start and end of flow |
| MetaMask (L1) | TX #2 (Approve), TX #3 (Transfer) | After L2→L1 message ready |
| Relayer (L1) | TX #4 (Execute) | After user transfers USDC |

---

## Error Handling

If any transaction fails, the flow stops at that step:
- **TX #1 fails**: No state changed, user can retry
- **TX #2/3 fails**: L2 intent exists, but no funds moved - can retry L1 steps
- **TX #4 fails**: Intent queued in portal retry queue, retryable later
- **TX #5 fails**: Shares on L1, message exists - can retry finalization

Code location for error handling: `deposit.ts:133-223` (catch blocks per step)
