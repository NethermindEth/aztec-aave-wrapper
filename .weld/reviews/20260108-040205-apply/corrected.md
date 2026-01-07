1. Research was completed on Aztec, Wormhole, and Aave
2. A comprehensive research document was prepared
3. Various technical findings and recommendations

But the actual file content is just the assistant's conversation/process notes, not the promised research document.

Given this is a greenfield project with only `spec.md` as actual content, I need to produce a corrected version that accurately reflects reality - which is that no actual research document exists yet, only process notes.

# Aztec Aave Wrapper Research

**Status**: [NOT IMPLEMENTED] - This document contains preliminary research notes. No implementation exists yet.

## Project State

This is a **greenfield project**. The only substantive file is `spec.md`, which defines the MVP architecture for an Aztec-based Aave wrapper using Wormhole for cross-chain bridging.

**Current repository contents:**
- `spec.md` - MVP specification document
- `.weld/` - Configuration and session artifacts
- No implementation code exists

---

## Architecture Overview (from spec.md)

The specification follows the **Aztec Uniswap L1-from-L2 tutorial pattern** with three layers:

| Layer | Component | Purpose |
|-------|-----------|---------|
| **L2 (Noir)** | `AaveWrapperL2` | Creates private intents and position receipts |
| **L1 (Solidity)** | `AztecAavePortalL1` | Consumes Aztec messages, bridges to target chain via Wormhole |
| **Target (Solidity)** | `AaveExecutorTarget` | Performs Aave operations, returns confirmations |

---

## Key Dependencies (Planned)

| Layer | Dependencies |
|-------|-------------|
| **L2** | `aztec-nr`, Noir, Aztec sandbox |
| **L1** | Aztec L1 artifacts, Wormhole Solidity SDK |
| **Target** | Aave V3 IPool interface, Wormhole SDK |
| **Tooling** | Bun, Foundry, Nargo (version must match aztec-packages) |

**Note**: Specific versions have not been verified against current Aztec releases. The version `aztec-packages-v3.0.0-devnet.20251212` mentioned in earlier notes should be verified before implementation.

---

## Technical Considerations

### Wormhole Integration
- **Mode B** (`transferTokensWithPayload`) is recommended by the spec for atomic token+message delivery
- Wormhole normalizes token amounts to 8 decimals - normalization logic required for tokens with different decimal precision

### Replay Protection
Three-layer protection specified:
1. VAA hash tracking on target chain
2. Intent ID tracking across all layers
3. Emitter verification

### Custody Model
The MVP uses a **custodial model** where `AaveExecutorTarget` holds all aTokens on behalf of users. User entitlements are tracked privately on L2 via `PositionReceiptNote`.

---

## Open Questions

1. **Target chain**: Arbitrum Sepolia vs local fork for MVP?
2. **Asset selection**: USDC (if token portal exists) or custom test token?
3. **Yield handling**: Return actual amount (with yield) or cap at principal?
4. **Wormhole testing**: Mock contracts or real testnet integration?

---

## Recommended Implementation Sequence

1. **Foundation**: Monorepo setup, tooling configuration, Docker Compose for local devnet
2. **L2 Contract**: `PositionReceiptNote`, intent creation, finalization logic
3. **L1 Portal**: Aztec message consumption, Wormhole bridging
4. **Target Executor**: VAA handling, Aave `supply()`/`withdraw()` integration
5. **E2E Integration**: Local testing progressing to testnet deployment

---

## References

- [Aztec Uniswap Tutorial](https://docs.aztec.network/developers/docs/tutorials/js_tutorials/uniswap) - Primary pattern reference
- [Nethermind Aztec-Wormhole Demo](https://github.com/NethermindEth/aztec-wormhole-app-demo) - Cross-chain integration reference
- [Aztec PXE Documentation](https://docs.aztec.network/developers/docs/concepts/pxe) - Private execution environment
- [Aztec Migration Notes](https://docs.aztec.network/developers/docs/resources/migration_notes) - Portal API versioning
