# TokenFaucet Implementation Research (Code-Verified)

## 1. Current L1 Token Reality

- `eth/contracts/mocks/MockERC20.sol` defines `contract USDC` with OpenZeppelin `AccessControl` and `MINTER_ROLE` gating for `mint(address,uint256)`.
- The contract in that file is **not** named `MockERC20`; it is named `USDC` and its constructor takes `(address defaultAdmin, address minter)`.
- `eth/contracts/mocks/MockLendingPool.sol` calls `MockERC20(aToken).mint/burn`, but there is no `MockERC20` contract defined in `MockERC20.sol` right now. This mismatch is a code issue to resolve before faucet work.
- `eth/test/Portal.t.sol` imports `MockERC20` from `MockERC20.sol` and instantiates it with `(name, symbol, decimals)`, which does not match the current `USDC` constructor signature.

## 2. Deployment Script Reality

- `scripts/deploy-local.ts` deploys `contracts/mocks/MockERC20.sol:MockERC20` with `(name, symbol, decimals)` args and then mints via `cast send mint(...)` using the deployer key.
- Given the current Solidity file only defines `USDC` and expects `(defaultAdmin, minter)`, the deploy-local contract path and constructor args are inconsistent with the code in `MockERC20.sol`.

## 3. Frontend Patterns

- `frontend/src/services/l1/tokens.ts` includes an ERC20 `mint` method that uses `walletClient.writeContract(...)` + `waitForTransactionReceipt(...)`.
- `frontend/src/types/state.ts` stores deployed addresses under `contracts` and currently has no faucet address entry.
- `frontend/public/.deployments.local.json` includes L1 and L2 addresses but no faucet address.

## 4. Implications for a Faucet

- A faucet contract must have `MINTER_ROLE` on the actual token contract for `mint()` to succeed.
- Before adding a faucet, the MockERC20/USDC contract naming and constructor mismatch should be resolved so deployment/test tooling aligns with the Solidity code.

## Summary

The existing faucet research doc must align with the current code state: the mock token is `USDC` with AccessControl, deployment scripts and tests still reference `MockERC20`, and a faucet would require explicit minter permissions. Until those naming/constructor mismatches are resolved, a faucet integration will not deploy or test cleanly.
