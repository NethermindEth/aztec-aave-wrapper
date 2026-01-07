# Spec: Aztec “Aave Wrapper” via Portal-Based Adapter + Wormhole Bridge

This document specifies an MVP architecture that mirrors the **Aztec Uniswap (L1-from-L2) tutorial pattern**—i.e., an Aztec L2 contract creates messages, and an L1 “portal” contract executes actions on behalf of the user so that *any third party can execute the L1 step without linking L1↔L2 identity*. ([Aztec Documentation][1])
It extends that model by using **Wormhole** as the cross-chain messaging / token movement layer to reach an Aave deployment on a non-Ethereum EVM chain (e.g., Arbitrum), consistent with the Nethermind demo’s “Aztec + Wormhole” integration theme. ([GitHub][2])

MVP should assume a run locally first approach first by running and deploying the contracts locally to anvil and aztec local network.

---

## 0. Toolchain
1. Bun latest for node packaging
2. Foundry for smart contract development 
3. Alloy for EVM integration
4. TypeScript

## 1. Goals and Non-Goals

### Goals (MVP)

1. Enable a user with funds on **Aztec L2** to:

   * **Deposit** into Aave (supply) on a target EVM chain (e.g., Arbitrum)
   * Receive a **private “position receipt”** on Aztec L2
   * Later **withdraw** back to Aztec L2
2. Preserve privacy by ensuring:

   * L2 user identity is not required on L1/target chain to execute the action (“anyone can execute” relay model). ([Aztec Documentation][1])
3. Provide an end-to-end, reproducible dev flow (sandbox/localnet + test chain).

### Non-Goals (MVP)

* Borrow/repay, eMode, liquidation, variable interest accounting on L2, partial withdrawals, multi-asset.
* A generalized Aave integration framework (that is Phase 2).
* Trustless relayer economics (use a simple relayer service or “anyone can call” initially).

---

## 2. High-Level Architecture

### Core components

**Aztec L2**

* `AaveWrapperL2` (Noir contract): creates intents, maintains private receipts, finalizes based on L1/bridge confirmations.

**Aztec L1 (Ethereum)**

* `AztecAavePortalL1` (Solidity): consumes Aztec outbox messages (L2→L1), interacts with token portals, and initiates Wormhole messages/transfers.

**Target EVM chain (e.g., Arbitrum)**

* `AaveExecutorTarget` (Solidity): receives Wormhole VAAs/messages, performs Aave actions, and returns confirmation + funds via Wormhole.

**Wormhole infra**

* Core Wormhole contracts + optional relayer depending on which integration mode you pick (see §6).

**Client**

* Aztec.js-based script / minimal UI that:

  * requests private execution via PXE (wallet/PXE does proving client-side) ([Aztec Documentation][3])
  * triggers “execute steps” (L1 + target) via relayer or public callable functions.

---

## 3. Data Model

### 3.1 Position receipt on Aztec L2 (private)

MVP uses a “receipt note” representing a claim on the portal-held Aave position.

`PositionReceiptNote` fields (suggested):

* `owner` (Aztec address/public key)
* `nonce`
* `assetId` (e.g., USDC)
* `shares` (units representing claim; MVP can use deposited amount 1:1 and ignore yield)
* `targetChainId`
* `aaveMarketId` (optional; or inferred by chain + asset)
* `status` (PendingDeposit | Active | PendingWithdraw)

**MVP simplification:** set `shares = principalDeposited` and do not attempt on-L2 interest accrual; settle deltas on withdrawal.

### 3.2 Cross-domain messages

You need stable message schemas with replay protection and correlation IDs.

Common fields:

* `action` (DEPOSIT / WITHDRAW)
* `intentId` (unique, commitment-friendly)
* `ownerL2` (Aztec address or note owner key)
* `asset` (ERC20 address on target chain; canonical mapping in config)
* `amount`
* `minOut` (optional for swap steps; not needed for Aave supply)
* `targetChainId`
* `deadline`
* `salt` / `nonce`

---

## 4. End-to-End Flows

The flow pattern mirrors the Uniswap tutorial steps: **burn/withdraw on L2 → L2→L1 message → L1 executes → deposit back to L2**, except here L1 is a routing/bridge hop to a target chain via Wormhole. ([Aztec Documentation][1])

### 4.1 Deposit (Supply) into Aave on target chain

**Step 0 — Preconditions**

* Token portal exists for the asset on Aztec L1 side (as assumed by the Uniswap tutorial). ([Aztec Documentation][1])
* Wormhole bridge is available between Ethereum and the target chain.

**Step 1 — User initiates on L2 (private)**
User calls `AaveWrapperL2.request_deposit(assetId, amount, targetChainId)`:

* Validates user has spendable private balance (or uses Aztec.nr token patterns).
* Creates a `DepositIntent` commitment (includes `intentId`).
* Creates L2→L1 message instructing `AztecAavePortalL1` to:

  1. withdraw/burn the L2 tokens to L1 (via token portal mechanics)
  2. initiate Wormhole transfer/message to target executor
* Emits an event/log for UX.

**Step 2 — L1 portal executes (public)**
Any actor (user or relayer) calls `AztecAavePortalL1.executeDeposit(intent)`:

* Consumes Aztec outbox message corresponding to `intentId`
* Withdraws the asset from the *input token portal* on L1 (as in Uniswap portal design). ([Aztec Documentation][1])
* Initiates Wormhole transfer + payload to target:

  * Payload: `{action: DEPOSIT, intentId, asset, amount, recipient: AaveExecutorTarget}`
  * Funds: `amount` of `asset` bridged to target

**Step 3 — Target executor supplies to Aave**
On target chain, once Wormhole delivery finalizes:

* `AaveExecutorTarget.consumeVAAAndExecute(intent)`:

  * Verifies VAA authenticity
  * Calls `AavePool.supply(asset, amount, onBehalfOf = AaveExecutorTarget)` (MVP custody)
  * Records executor-side accounting: `intentId -> principal`
  * Emits `DepositExecuted(intentId, aTokenAmount, timestamp)`

**Step 4 — Target executor returns confirmation + (optional) receipt**
Target sends Wormhole message back to L1 portal:

* Payload: `{intentId, status: SUCCESS, principal, aTokenBalanceDelta}`
* (No funds return on deposit)

**Step 5 — L1 portal posts completion to Aztec**
L1 portal sends L1→L2 message to `AaveWrapperL2.finalize_deposit(intentId, principal)`:

* This is analogous to “deposit output tokens to token portal so it can be deposited into L2” in Uniswap, except the “output” here is a private receipt note. ([Aztec Documentation][1])

**Step 6 — L2 finalizes (private)**
User calls `AaveWrapperL2.finalize_deposit(intentId)`:

* Verifies the portal completion message exists
* Mints/updates `PositionReceiptNote(status=Active, shares=principal)`
* Marks intent consumed

---

### 4.2 Withdraw (Redeem) back to Aztec L2

**Step 1 — User initiates on L2 (private)**
`AaveWrapperL2.request_withdraw(intentId, shares)`:

* Consumes/burns (or marks) receipt note
* Creates L2→L1 message to portal: `{action: WITHDRAW, intentId, amount=shares, asset, targetChainId}`

**Step 2 — L1 portal initiates Wormhole message**
`AztecAavePortalL1.executeWithdraw(intent)`:

* Consumes L2→L1 message
* Sends Wormhole payload to target executor requesting redemption:
  `{action: WITHDRAW, intentId, asset, amount}`

**Step 3 — Target executor withdraws from Aave**
`AaveExecutorTarget.executeWithdraw(intent)`:

* Calls `AavePool.withdraw(asset, amount, to = AaveExecutorTarget)`
* Bridges `amount` (or actual received) back to L1 portal via Wormhole

**Step 4 — L1 portal deposits funds back to Aztec**
On receiving bridged tokens on Ethereum:

* L1 portal deposits tokens into the Aztec token portal as “output tokens” so they are minted on L2 to the user, matching the Uniswap tutorial’s step 4/5 pattern. ([Aztec Documentation][1])
* Sends L1→L2 message to finalize withdraw.

**Step 5 — L2 finalizes**
User finalizes on L2; tokens become spendable privately.

---

## 5. Contract Interfaces (MVP)

### 5.1 `AaveWrapperL2` (Noir)

Public functions (names illustrative):

* `request_deposit(assetId: Field, amount: u128, targetChainId: u32, deadline: u64) -> intentId`

* `finalize_deposit(intentId)`

* `request_withdraw(intentId, amount: u128, deadline: u64)`

* `finalize_withdraw(intentId)`

Private state:

* `receipts: PrivateSet<PositionReceiptNote>` (or equivalent Aztec.nr patterns)
* `intents: map(intentId -> status)` (public or private depending on leakage tradeoff)

Events:

* `DepositRequested(intentId, assetId, amount, targetChainId)`
* `WithdrawRequested(intentId, amount)`

### 5.2 `AztecAavePortalL1` (Solidity)

* `executeDeposit(DepositIntent calldata intent, bytes calldata aztecProofDataOrOutboxArgs)`
* `executeWithdraw(WithdrawIntent calldata intent, ...)`

Responsibilities:

* Consume Aztec outbox messages (do not hardcode inbox/outbox version; store deployment-specific version as per migration notes, since portal templates have changed over time). ([Aztec Documentation][4])
* Interact with token portals to withdraw/deposit L1 ERC20.
* Interact with Wormhole to send messages/bridge tokens.

### 5.3 `AaveExecutorTarget` (Solidity)

* `consumeAndExecuteDeposit(bytes calldata wormholeVAA)`
* `consumeAndExecuteWithdraw(bytes calldata wormholeVAA)`

Responsibilities:

* Verify VAA, prevent replay
* Perform Aave calls
* Bridge confirmations/funds back

---

## 6. Wormhole Integration Modes (choose one for MVP)

### Mode A — “Message-only + separate token bridge”

* Wormhole message instructs target to act.
* Token movement handled by a dedicated bridge (or Wormhole token bridge if supported in your deployment).
* Pros: simpler separation of concerns.
* Cons: more moving parts.

### Mode B — “Message + token transfer coupled”

* Use Wormhole transfer with payload so the target receives funds and instructions atomically (preferred if your Wormhole stack supports it).
* Pros: fewer race conditions.
* Cons: requires correct Wormhole configuration and more careful handling.

Given the Nethermind demo explicitly combines Aztec + Wormhole for cross-chain transfers, the spec assumes Mode B as the default. ([GitHub][2])

---

## 7. Trust, Custody, and Privacy Properties

### Custody

* On the target chain, **`AaveExecutorTarget` owns the Aave position** (aTokens held by the executor address).
* This is custodial at the position layer; user entitlement is represented privately on L2.

### Privacy

* L1/target execution can be performed by any relayer, so execution does not require L1 address linkage to the user (same rationale as Uniswap tutorial). ([Aztec Documentation][1])
* Note: running PXE against a remote node can leak access patterns; users can mitigate by running their own node. ([Aztec Documentation][3])

---

## 8. Failure Handling / Edge Cases (MVP rules)

1. **Timeouts / deadlines**

   * If `deadline` passes, executor refuses to act; intent can be cancelled after a grace period.
2. **Partial execution**

   * If Wormhole delivery succeeds but Aave call fails, executor sends `FAIL` status and returns funds to portal (if already bridged).
3. **Replay protection**

   * Each layer stores `consumed[intentId]=true`.
   * Wormhole VAA digest tracked on target.
4. **Accounting mismatch**

   * MVP asserts principal-only: withdraw returns at most `principal` unless you explicitly decide to return accrued yield.
5. **Portal versioning**

   * Store inbox/outbox addresses + version at deployment; do not assume constant version across deployments. ([Aztec Documentation][4])

---

## 9. Repository Structure (recommended)

Monorepo layout:

* `l2/`

  * `contracts/aave_wrapper_l2/` (Noir)
  * `contracts/token/` (if you need a local private token for demos)
  * `tests/` (Noir unit tests)
* `l1/`

  * `contracts/AztecAavePortalL1.sol`
  * `scripts/deploy.ts`
  * `test/portal.spec.ts`
* `target/`

  * `contracts/AaveExecutorTarget.sol`
  * `scripts/deploy.ts`
  * `test/executor.spec.ts`
* `relayer/` (optional)

  * `watch_outbox.ts` → triggers portal execute
  * `watch_wormhole.ts` → triggers target execute
* `e2e/`

  * `e2e.spec.ts` (Aztec.js orchestrated)
  * `config/addresses.json`

---

## 10. Testing Strategy

### Unit tests

* Noir: intent creation, receipt mint/burn, finalize gating.
* Solidity (L1 + target): message validation, replay protection, failure paths.

### Integration/E2E (most important)

Single test that does:

1. Create Aztec account + PXE
2. Mint private funds (or bridge in)
3. `request_deposit` on L2
4. Execute L1 portal
5. Execute target executor
6. Finalize on L2 and assert receipt exists
7. `request_withdraw`
8. Execute target + L1
9. Finalize and assert L2 balance restored

The Uniswap tutorial includes an explicit e2e testing approach for its portal flow; follow that pattern for this adapter. ([Aztec Documentation][1])

---

## 11. Deployment Configuration

Config file keys:

* `aztec`: rpc urls, PXE url, L2 contract addresses
* `ethereumL1`: token portal addresses, inbox/outbox + version, portal address
* `wormhole`: chain IDs, core contracts, relayer endpoints
* `targetChain`: Aave Pool address, asset addresses, executor address

---

## 12. MVP Acceptance Criteria

1. A fresh dev environment can run:

   * `make devnet-up`
   * `make deploy`
   * `make e2e`
2. E2E produces:

   * A completed deposit intent with an Active receipt on L2
   * A completed withdraw returning funds to L2 private balance
3. Relayer optional:

   * Manual “execute” calls are possible by anyone with RPC access (privacy property aligns with Uniswap tutorial). ([Aztec Documentation][1])

---

## 13. Phase 2 Extensions (after MVP)

* Borrow/repay + health factor constraints
* Multi-asset mapping + approvals
* Yield handling:

  * either return yield on withdrawal
  * or issue yield notes periodically via oracle sync
* Non-custodial improvements:

  * per-user sub-accounts or cryptographic segregation (more complex)
* Relayer economics (fees, sponsorship, MEV protection)

---

[1]: https://docs.aztec.network/developers/docs/tutorials/js_tutorials/uniswap?utm_source=chatgpt.com "Swap on L1 from L2s | Privacy-first zkRollup"
[2]: https://github.com/NethermindEth/aztec-wormhole-app-demo?utm_source=chatgpt.com "NethermindEth/aztec-wormhole-app-demo"
[3]: https://docs.aztec.network/developers/docs/concepts/pxe?utm_source=chatgpt.com "Private Execution Environment (PXE) | Privacy-first zkRollup"
[4]: https://docs.aztec.network/developers/docs/resources/migration_notes?utm_source=chatgpt.com "Migration notes | Privacy-first zkRollup | Aztec Documentation"
