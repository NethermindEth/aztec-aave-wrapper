# Hardcoded Values Report: Frontend

**Generated**: 2026-01-16 (Updated)
**Path analyzed**: `/frontend/src`

## Summary

| Risk Level | Count |
|------------|-------|
| High | 6 |
| Medium | 17 |
| Low | 35+ |

**New Findings**:
- Debug console.log statements in production code (Medium risk)
- Hardcoded chain ID references (Low risk)
- Merkle proof generation with magic numbers (Medium risk)

---

## High Risk (Action Required)

### Mock/Devnet Values in Production Code

| Location | Value | Issue |
|----------|-------|-------|
| `flows/deposit.ts:450` | `100n` | Mock L2 block number hardcoded (devnet only) |
| `flows/withdraw.ts:458` | `100n` | Same mock L2 block number |
| `flows/withdraw.ts:471` | `% 1000000n` | Magic modulo for mock leaf index generation |
| `flows/deploy.ts:42` | `0x000...001` | Placeholder portal address (PLACEHOLDER_L2_ADDRESS) |

**Impact**: These values will cause production failures when deployed to mainnet/testnet.

**Recommendation**: Remove or wrap in feature flags (`if (isDevnet)`). The mock leaf index generation and block numbers are devnet-only patterns that must not reach production.

### Environment-Specific Endpoints

| Location | Value | Issue |
|----------|-------|-------|
| `config/chains.ts:37` | `https://eth.llamarpc.com` | Production L1 RPC exposed, rate-limit risk |
| `config/constants.ts:17-21` | `1800, 86400, 3600` sec | Deadline constraints duplicated from contracts |

**Recommendation**: Enforce `VITE_L1_RPC_URL` environment variable in production builds. Import deadline constants from shared package instead of duplicating.

---

## Medium Risk (Should Address)

### Polling Intervals

| Location | Value | Context | Suggestion |
|----------|-------|---------|------------|
| `components/L1ConnectionStatus.tsx:18` | `4000` ms | Block poll interval | Too aggressive for prod, use `10000` ms+ |
| `components/L2ConnectionStatus.tsx:22` | `4000` ms | Block poll interval | Same issue |
| `components/TopBar.tsx:40` | `4000` ms | Block poll interval | Same issue |
| `config/constants.ts:60` | `5000` ms | Message poll interval | Should be configurable per env |

**Impact**: Frequent polling can trigger RPC rate limits on public nodes.

**Recommendation**: Create environment-based polling config:

```typescript
// config/environment.ts
export const POLLING = {
  dev: { blockInterval: 4000, messageInterval: 5000 },
  prod: { blockInterval: 10000, messageInterval: 10000 }
}
```

### Cross-Chain Message Timeouts

| Location | Value | Context | Issue |
|----------|-------|---------|-------|
| `flows/deposit.ts:185-186` | `30 retries x 2s` | L2->L1 message wait (60s total) | Too short for mainnet |
| `flows/withdraw.ts:209-210` | `30 retries x 2s` | Same as deposit | Same issue |
| `config/constants.ts:62` | `300000` ms (5 min) | Message timeout | Should be env-configurable |

**Impact**: Mainnet L2->L1 messages can take longer than 60 seconds.

**Recommendation**: Increase to `maxAttempts: 60, intervalMs: 5000` for production (5-minute total).

### Transaction Polling Timeouts

| Location | Value | Context | Issue |
|----------|-------|---------|-------|
| `services/l1/portal.ts:509` | `120000` ms (2 min) | L1 tx confirmation | Too short for congested networks |
| `services/l2/operations.ts:637` | `120000` ms (2 min) | L2 tx confirmation | Same issue |

**Recommendation**: Make configurable: dev 2 min, prod 5 min.

### Debug Console Statements

| Location | Type | Context | Issue |
|----------|------|---------|-------|
| `flows/deposit.ts:426-448` | `console.log` | 15+ debug statements for deposit intent | Left in production code |
| `flows/deposit.ts:466-491` | `console.log` | Mock outbox verification debugging | Left in production code |
| `flows/deposit.ts:548` | `console.error` | Error logging in catch block | Acceptable if not sensitive |
| `services/l2/operations.ts:301,388,393` | Debug comments | "Debug: Log parameters" | Comments indicate debug code |

**Impact**:
- Exposes internal state and sensitive data in browser console
- Performance overhead from unnecessary logging
- Makes debugging harder with noise in production

**Recommendation**:
- Remove all `console.log` statements from flows (deposit/withdraw)
- Use proper logging service (`store/logger.ts`) instead
- Keep `console.error` only for critical errors
- Wrap debug code in `if (import.meta.env.DEV)` checks

### Inconsistent Retry Strategies

| Location | Max Backoff | Context |
|----------|-------------|---------|
| `flows/deposit.ts:628` | `10000` ms | Deposit retries (exponential: `min(1000 * 2^(n-1), 10000)`) |
| `flows/withdraw.ts:606` | `10000` ms | Withdraw retries (exponential: `min(1000 * 2^(n-1), 10000)`) |
| `flows/deploy.ts:312` | `5000` ms | Deploy retries (exponential: `min(1000 * 2^(n-1), 5000)`) |

**Impact**: Different max backoffs lead to inconsistent user experience and hard-to-predict retry behavior.

**Recommendation**: Centralize retry logic:

```typescript
// utils/retry.ts
export const RETRY_STRATEGIES = {
  crossChain: { maxBackoff: 10000, maxAttempts: 5, baseDelay: 1000 },
  deploy: { maxBackoff: 5000, maxAttempts: 3, baseDelay: 1000 }
}
```

---

## Low Risk (Acceptable)

### UI/UX Constants

| Location | Value | Reason Acceptable |
|----------|-------|-------------------|
| `config/constants.ts:73-75` | `5000, 8000, 4000` ms | Toast durations - UX preference |
| `config/constants.ts:82-83` | `300, 500` ms | Input/search debounce - standard values |
| `components/TopBar.tsx:85` | `150` ms | Flash animation - CSS timing |
| `components/AddressList.tsx:82` | `2000` ms | Copy notification - UX preference |
| `components/LogViewer.tsx:115` | `300` px | Max height - UI layout |

### Well-Named Constants

| Location | Value | Reason Acceptable |
|----------|-------|-------------------|
| `config/constants.ts:17-21` | Deadline constraints | Defined in dedicated constants file (though should be imported from contracts) |
| `App.tsx:78-79` | `1_000_000n` | USDC decimals divisor - constant calculation |
| `flows/deploy.ts:42` | PLACEHOLDER_L2_ADDRESS | Well-documented constant with clear purpose |

### Chain-Specific Values

| Location | Value | Reason Acceptable |
|----------|-------|-------------------|
| `services/wallet/ethereum.ts:5` | `31337` comment | Documentation reference to Anvil chain ID |
| `components/WalletInfo.tsx:301` | `31337` hardcoded | User-facing error message for wrong network |
| `config/chains.ts:37,42` | RPC URLs with fallbacks | Environment-variable-first with safe defaults |

**Note**: Chain ID 31337 is Anvil's standard, but should still be imported from shared constants.

### Test Fixtures

| Location | Value | Reason Acceptable |
|----------|-------|-------------------|
| `config/artifacts.ts:56` | `/artifacts/${contractName}.json` | Build-time path for public directory |
| `components/DepositFlow.tsx:27-52` | Step time estimates | UI-only, not used for actual timeouts |

---

## Recommended Action Items

### 1. Immediate (Before Mainnet Deploy)

- [ ] Remove or feature-flag mock values (`100n` L2 blocks, `% 1000000n` leaf index)
- [ ] **CRITICAL**: Remove all debug `console.log` statements from `flows/deposit.ts` and `flows/withdraw.ts`
- [ ] Enforce `VITE_L1_RPC_URL` in production builds (fail if not set)
- [ ] Increase cross-chain message polling to 5-minute total timeout
- [ ] Import deadline constraints from shared package
- [ ] Replace hardcoded `31337` chain ID with shared constant

### 2. High Priority

- [ ] Create environment-based configuration system:

```typescript
// frontend/src/config/environment.ts
export const getConfig = (env: 'dev' | 'testnet' | 'mainnet') => ({
  polling: {
    blockInterval: env === 'dev' ? 4000 : 10000,
    messageInterval: env === 'dev' ? 5000 : 10000,
    txTimeout: env === 'dev' ? 120000 : 300000
  },
  retry: {
    crossChainMaxAttempts: env === 'dev' ? 30 : 60,
    crossChainInterval: env === 'dev' ? 2000 : 5000
  }
})
```

### 3. Medium Priority

- [ ] Centralize retry strategies in `utils/retry.ts`
- [ ] Move magic numbers to constants:
  - `1000000n` (modulo divisor for mock leaf index) -> remove entirely or add to test utils
  - USDC decimals -> import from shared package
- [ ] Create debug logging guard utility:
  ```typescript
  // utils/debug.ts
  export const debugLog = import.meta.env.DEV ? console.log : () => {};
  ```
- [ ] Replace direct `console.log` with `logInfo`/`logStep` from `store/logger.ts`

### 4. Low Priority (Nice to Have)

- [ ] Make toast durations configurable via user settings
- [ ] Consolidate all timing constants in `config/constants.ts`

---

## Configuration Files Detected

The codebase already has:

- `config/constants.ts` - Central constants file
- `config/chains.ts` - Chain-specific config with env var support
- `.env` support via Vite (`VITE_*` variables)
- Shared package at `../shared/types` (mentioned in imports)

**Missing**:

- Environment-based configuration (dev/testnet/mainnet profiles)
- Feature flag system for devnet-specific code
- Build-time validation of required env vars

---

## Code Quality Notes

### Positive Observations

- Constants are centralized in `config/constants.ts` (good pattern)
- Environment variables used for RPC URLs (partial implementation)
- Retry logic exists (just needs standardization)

### Concerns

- **CRITICAL**: Debug console.log statements left in production flows
- Mock values intermixed with production code (high risk)
- Polling intervals optimized for devnet, not production networks
- Duplicate deadline constraints (should import from contracts)
- No validation that production builds have required config set

### Additional Notes

**Console Logging Distribution** (26 files with console statements):
- Most are in documentation comments (acceptable)
- ~20 active `console.log` in `flows/deposit.ts` (CRITICAL - remove)
- Error handlers using `console.error` (acceptable pattern)
- Pino shim redirects to console (acceptable for browser environment)
- Warnings in client factories (acceptable for dev env detection)

**Port Numbers**: No hardcoded ports found in source (good). Vite config has `port: 3000` but that's dev server only (acceptable).

**Secret Management**: Uses localStorage with encryption via `services/secrets.ts` (acceptable for MVP, should move to secure enclave for production).
