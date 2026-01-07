Let me start by exploring the existing codebase structure and then conduct research on the key technologies involved.
Good, this is a greenfield project with just the spec. Let me now research the key technologies involved. I'll launch parallel research tasks for Aztec, Wormhole, and Aave.
I don't have WebFetch permissions, so let me use WebSearch to gather information instead, and continue with other research approaches.
Let me check on the background agent's progress and also read about the Aztec patterns from my existing knowledge.
There's already some preliminary research. Let me check the background agent and also explore what other research exists.
Excellent! The background agent has completed with comprehensive Aztec SDK research. Now let me update my todos and continue gathering information on the remaining areas, then compile the research document.
`★ Insight ─────────────────────────────────────`
The Aztec ecosystem follows a **strict version coupling** between:
- Nargo (Noir compiler)
- `aztec-packages` git tag
- `@aztec/aztec.js` npm package

**Use the latest version: `aztec-packages-v3.0.0-devnet.20251212`** — all components must use the same release to ensure ABI compatibility. The migration notes pattern mentioned in the spec (`[4]`) exists specifically because portal APIs change between versions.
`─────────────────────────────────────────────────`

Now let me compile my knowledge on Wormhole and Aave, and write the comprehensive research document:
I've completed the comprehensive research analysis for the Aztec Aave Wrapper MVP. The document is ready to be written to `RESEARCH.md` once you grant write permission.

Here's a summary of the key findings:

## Research Summary

### Architecture Analysis
The specification follows the **Aztec Uniswap L1-from-L2 tutorial pattern** - a proven three-layer architecture:
- **L2 (Noir)**: Creates private intents and position receipts using encrypted notes
- **L1 (Solidity Portal)**: Consumes Aztec messages and bridges to target chain via Wormhole
- **Target (Solidity Executor)**: Performs Aave operations and returns confirmations

`★ Insight ─────────────────────────────────────`
- The **"anyone can execute"** pattern is privacy-critical: L1 portal functions must be public so any address can trigger execution, breaking the link between L1 executor and L2 user identity.
- **Intent correlation** via `intentId` flowing through all layers enables idempotent handling and cross-chain debugging.
`─────────────────────────────────────────────────`

### Key Dependencies

| Layer | Critical Dependencies |
|-------|----------------------|
| **L2** | `aztec-nr`, `value_note` (use `aztec-packages-v3.0.0-devnet.20251212`) |
| **L1** | `@aztec/l1-artifacts`, `@wormhole-foundation/wormhole-solidity-sdk` |
| **Target** | `@aave/v3-core`, Wormhole SDK |
| **Tooling** | Bun, Foundry, Nargo 3.0.0 (must match aztec-packages version) |

### Top Technical Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Aztec API breaking changes | High | Use latest `aztec-packages-v3.0.0-devnet.20251212` consistently across all components |
| Token decimal mismatch | High | Wormhole normalizes to 8 decimals - explicit normalization logic |
| Cross-chain message ordering | High | Three-layer replay protection (VAA hash, intentId, emitter check) |
| Custody of aTokens | Medium | Multi-sig admin, time-locked upgrades |

### Open Questions Requiring Decision

1. **Target chain**: Arbitrum Sepolia vs local fork for MVP?
2. **Asset selection**: USDC (if portal exists) or custom test token?
3. **Yield handling**: Return actual (with yield) or cap at principal?
4. **Wormhole testing**: Mock contracts or real testnet?

### Recommended Implementation Sequence

1. **Foundation**: Monorepo setup, tooling, Docker Compose devnet
2. **L2 Contract**: PositionReceiptNote, intents, finalization
3. **L1 Portal**: Aztec message consumption, Wormhole bridging
4. **Target Executor**: VAA handling, Aave integration
5. **E2E Integration**: Local testing → testnet graduation

`★ Insight ─────────────────────────────────────`
- The **custodial model** (executor holds all aTokens) is a known MVP trade-off - documented but important to understand the security implications.
- **Wormhole Mode B** (`transferTokensWithPayload`) is recommended over Mode A for atomic token+message delivery.
- Local development requires orchestrating **multiple services** (Aztec sandbox, Anvil, mock Wormhole) - Docker Compose is essential.
`─────────────────────────────────────────────────`

Would you like me to proceed with writing the full research document to `RESEARCH.md`?
