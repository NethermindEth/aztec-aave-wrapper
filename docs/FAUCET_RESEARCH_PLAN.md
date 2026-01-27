# TokenFaucet Research Plan (Code-Verified)

## Current Reality (Verified)

- `eth/contracts/mocks/MockERC20.sol` defines `contract USDC` (not `MockERC20`) with `AccessControl` and `MINTER_ROLE` gating `mint()`.
- `scripts/deploy-local.ts` and `eth/test/Portal.t.sol` still reference `MockERC20` with `(name, symbol, decimals)` constructor args, which does **not** match the current Solidity file.
- `frontend/public/.deployments.local.json` has no faucet address, and `frontend/src/types/state.ts` has no faucet field.

**Implication:** The MockERC20/USDC naming + constructor mismatch must be resolved before any faucet implementation can be deployed or tested reliably.

---

## Phase 0: Fix the Token Contract Mismatch (Required) **COMPLETE**

### Step 0.1: Decide the canonical mock token contract **COMPLETE**

Choose one of:
- **Option A (recommended):** Rename/restore a `MockERC20` contract with `(name, symbol, decimals)` and unrestricted `mint`/`burn` to match existing tests and deploy scripts.
- **Option B:** Update tests and deploy scripts to use `USDC` with `(defaultAdmin, minter)` and role-based minting.

### Step 0.2: Apply the chosen fix **COMPLETE**

Files affected (depending on option):
- `eth/contracts/mocks/MockERC20.sol`
- `scripts/deploy-local.ts`
- `eth/test/Portal.t.sol`
- `eth/contracts/mocks/MockLendingPool.sol`

Validation:
```bash
cd eth && forge build
```

Failure modes:
- Constructor arg mismatch
- Missing contract symbol imports
- Deployment script pointing to non-existent contract name

---

## Phase 1: TokenFaucet Contract **COMPLETE**

### Step 1: Create TokenFaucet.sol **COMPLETE**

Goal: Implement a rate-limited faucet wrapper around the mock token’s `mint()`.

Files:
- `eth/contracts/mocks/TokenFaucet.sol` (new)

Validation:
```bash
cd eth && forge build
```

Failure modes:
- Wrong token interface
- Missing access control (if using USDC + MINTER_ROLE)

### Step 2: Add TokenFaucet unit tests **COMPLETE**

Files:
- `eth/test/TokenFaucet.t.sol` (new)

Validation:
```bash
cd eth && forge test --match-contract TokenFaucetTest -vv
```

---

## Phase 2: Deployment Integration

### Step 3: Add faucet to deployment addresses **COMPLETE**

Files:
- `scripts/deploy-local.ts` (extend `DeploymentAddresses.l1` with `faucet`)

### Step 4: Deploy TokenFaucet after mock token **COMPLETE**

Files:
- `scripts/deploy-local.ts` (deploy `TokenFaucet` after USDC/mock token)

### Step 5: Persist faucet address

Files:
- `scripts/deploy-local.ts` (ensure faucet address is saved into `.deployments.local.json`)

Validation:
```bash
test -f .deployments.local.json && grep -q "faucet" .deployments.local.json
```

---

## Phase 3: Frontend Service Layer

### Step 6: Add faucet service

Files:
- `frontend/src/services/l1/faucet.ts` (new)

### Step 7: Load faucet address in frontend

Files:
- `frontend/src/services/deployments.ts`

---

## Phase 4: Frontend State + UI

### Step 8: Add faucet address to state types

Files:
- `frontend/src/types/state.ts`

### Step 9: Initialize faucet state

Files:
- `frontend/src/types/state.ts`

### Step 10: Create FaucetCard component

Files:
- `frontend/src/components/FaucetCard.tsx` (new)

---

## Phase 5: Integration + Verification

### Step 11: Wire FaucetCard into App

Files:
- `frontend/src/App.tsx`

### Step 12: Build + verify

Validation:
```bash
cd eth && forge test -vv
cd ../frontend && bun run build
```

---

## Summary

The faucet work depends on first resolving the current MockERC20/USDC mismatch. Once that is fixed, the TokenFaucet contract, deployment updates, and frontend integration follow a standard pattern already present in the repo.
