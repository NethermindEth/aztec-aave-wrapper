# Wormhole Mock Contracts

Mock implementations of Wormhole contracts for local testing without external Wormhole infrastructure.

## Contracts

### MockWormholeTokenBridge.sol
Mock implementation of the Wormhole Token Bridge for cross-chain token transfers.

**Features:**
- Token locking/unlocking mechanism
- 8-decimal normalization (Wormhole standard)
- VAA generation and redemption
- Transfer completion tracking

**Key Functions:**
- `transferTokensWithPayload()` - Lock tokens and create a pending transfer
- `completeTransferWithPayload()` - Redeem tokens using a VAA
- `normalizeAmount()` - Convert token amounts to 8 decimals
- `denormalizeAmount()` - Convert back from 8 decimals

**Testing Notes:**
- Tokens are locked in the contract during transfer
- VAAs are simplified (just sequence number as bytes32)
- Use `generateMockVAA()` to create VAAs for testing

### MockWormholeRelayer.sol
Mock implementation of the Wormhole Relayer for automatic message delivery.

**Features:**
- Message queueing with sequence tracking
- Manual delivery mode (no automatic relaying)
- Delivery cost estimation (fixed 0.1 ETH)
- Support for refund parameters

**Key Functions:**
- `sendPayloadToEvm()` - Queue a message for delivery
- `manualDeliver()` - Manually trigger message delivery (testing only)
- `quoteEVMDeliveryPrice()` - Get delivery cost estimate

**Testing Notes:**
- Messages are NOT automatically delivered
- Call `manualDeliver(sequence)` to trigger delivery
- Target contract must implement `receiveWormholeMessages()`

### MockWormholeCore.sol
Simplified mock of Wormhole Core for L1 message publishing.

**Features:**
- Message publishing with sequence tracking
- Basic guardian set management
- Chain ID management
- Zero message fees for testing

**Key Functions:**
- `publishMessage()` - Publish a message and get sequence number
- `getCurrentSequence()` - Get current sequence counter
- `chainId()` - Get Wormhole chain ID

## Usage

### Deployment

Use the deployment script:

```bash
bun run scripts/deploy-mocks.ts
```

This will deploy:
- `MockWormholeCore` on L1
- `MockWormholeTokenBridge` on L1
- `MockWormholeRelayer` on L1
- `MockWormholeCore` on target chain

Addresses are saved to `.wormhole-mocks.json`.

### Testing

Run the comprehensive test suite:

```bash
cd l1 && forge test --match-contract MockWormhole -vv
```

### Example: Token Transfer

```solidity
// Step 1: Approve and transfer tokens
usdc.approve(address(tokenBridge), amount);
uint64 sequence = tokenBridge.transferTokensWithPayload(
    address(usdc),
    amount,
    targetChainId,
    recipientBytes32,
    0, // nonce
    payload
);

// Step 2: Generate VAA (on target chain)
bytes memory vaa = tokenBridge.generateMockVAA(sequence);

// Step 3: Complete transfer (on target chain)
bytes memory returnedPayload = tokenBridge.completeTransferWithPayload(vaa);
```

### Example: Message Delivery

```solidity
// Step 1: Send message
uint64 sequence = relayer.sendPayloadToEvm{value: 0.1 ether}(
    targetChainId,
    targetAddress,
    payload,
    0, // receiverValue
    200000 // gasLimit
);

// Step 2: Manually deliver (testing only)
relayer.manualDeliver(sequence);
```

## Token Normalization

Wormhole normalizes all token amounts to 8 decimals for cross-chain transfers:

- **6 decimals (USDC):** 1000 USDC = 1000 * 10^6 → normalized to 1000 * 10^8
- **8 decimals (WBTC):** 1 WBTC = 1 * 10^8 → stays as 1 * 10^8
- **18 decimals (WETH):** 1 WETH = 1 * 10^18 → normalized to 1 * 10^8

Always use `normalizeAmount()` before bridging and `denormalizeAmount()` on the target chain.

## Limitations

These are TESTING MOCKS ONLY. They:

- Skip all cryptographic signature verification
- Use simplified VAA format (sequence as bytes32)
- Require manual message delivery
- Have no security guarantees
- Should NEVER be used in production

## See Also

- Comprehensive tests: `test/MockWormhole.t.sol`
- Wormhole interfaces: `contracts/interfaces/IWormhole*.sol`
- Target chain mocks: `target/contracts/mocks/MockWormholeCore.sol`
