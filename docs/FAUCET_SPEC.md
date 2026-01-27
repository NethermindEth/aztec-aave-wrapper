# Token Faucet Specification

> Enable users to easily acquire test USDC and try the Aztec Aave Wrapper protocol on testnets.

## Overview

Add a token faucet for testnet deployments that allows users to obtain test USDC with rate limiting. This simulates the real-world workflow where users need USDC to deposit into Aave.

## Current State

### Mock Contracts Architecture

The protocol uses **MockERC20** to simulate both real tokens on testnets:

| Contract Instance | Simulates | Purpose |
|-------------------|-----------|---------|
| MockERC20 (USDC) | USDC stablecoin | User deposits, bridging to L2 |
| MockERC20 (aUSDC) | Aave aToken | Lending pool liquidity tokens, yield accrual |

Both are deployed via `scripts/deploy-local.ts`:
- **USDC**: `MockERC20("Mock USDC", "USDC", 6)` - stored as `mockUsdc`
- **aUSDC**: `MockERC20("Mock aUSDC", "aUSDC", 6)` - used by MockLendingPool

### MockERC20 Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    // Unrestricted mint - used by:
    // 1. TokenFaucet (rate-limited user distribution)
    // 2. MockLendingPool (aToken minting on supply)
    // 3. Test scripts (initial token setup)
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}
```

### Current Gap

- No user-facing faucet for obtaining test USDC
- Users must use CLI (`cast send`) or receive tokens from deployer
- Frontend cannot help users get started

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| F1 | Users can mint test USDC from the frontend | Must |
| F2 | Rate limiting prevents abuse (max mint per address per cooldown) | Should |
| F3 | Clear feedback on mint success/failure | Must |
| F4 | Display remaining cooldown time if rate limited | Should |
| F5 | Faucet address included in deployment output | Must |

### Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NF1 | Faucet contract uses minimal gas (~50k for mint) |
| NF2 | Frontend integration matches existing design system |
| NF3 | No external dependencies beyond existing stack |

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Frontend (SolidJS)                        │
│  ┌─────────────────┐                                                │
│  │   FaucetCard    │◄──────── New component in App.tsx              │
│  │  - Mint button  │                                                │
│  │  - Cooldown UI  │                                                │
│  └────────┬────────┘                                                │
│           │                                                         │
│  ┌────────▼────────┐      ┌─────────────────────┐                   │
│  │ services/l1/    │      │ .deployments.local  │                   │
│  │   faucet.ts     │◄─────│   .json             │                   │
│  └────────┬────────┘      │ (l1.faucet address) │                   │
└───────────┼───────────────└─────────────────────┘───────────────────┘
            │ viem writeContract (drip)
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    L1 (Anvil / Testnet)                             │
│                                                                     │
│  ┌─────────────────┐         ┌─────────────────┐                    │
│  │  TokenFaucet    │────────►│   MockERC20     │                    │
│  │  - drip()       │  mint() │   (USDC)        │                    │
│  │  - cooldowns    │         │                 │                    │
│  │  - dripAmount   │         │  unrestricted   │                    │
│  └─────────────────┘         └────────┬────────┘                    │
│                                       │                             │
│                              ┌────────▼────────┐                    │
│                              │   MockERC20     │                    │
│                              │   (aUSDC)       │                    │
│                              │                 │                    │
│                              │  used by        │                    │
│                              │  MockLendingPool│                    │
│                              └─────────────────┘                    │
└─────────────────────────────────────────────────────────────────────┘
```

**Key**: TokenFaucet calls MockERC20's unrestricted `mint()` with rate limiting for user distribution.

### Contract Design

**Option A: Wrapper Faucet Contract** (Recommended)
- New `TokenFaucet.sol` contract wraps `MockERC20.mint()`
- Adds rate limiting logic (cooldown per address)
- Deployed alongside other mock contracts
- No permission changes needed - MockERC20 has unrestricted mint

**Option B: Modify MockERC20**
- Add rate limiting directly to MockERC20 contract
- Would break MockLendingPool's aToken minting
- Would break test scripts that need unrestricted minting

**Decision: Option A** - Keeps MockERC20 unrestricted for protocol use (aTokens, tests) while providing rate-limited user distribution via TokenFaucet.

## Contract Specification

### TokenFaucet.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

interface IMintable {
    function mint(address to, uint256 amount) external;
}

/**
 * @title TokenFaucet
 * @notice Rate-limited faucet for test token distribution
 * @dev Wraps MockERC20.mint() with cooldown-based rate limiting for user distribution.
 */
contract TokenFaucet {
    // ==========================================================================
    // State
    // ==========================================================================

    IMintable public immutable token;
    uint256 public immutable dripAmount;
    uint256 public immutable cooldownSeconds;

    /// @notice Last drip timestamp per address
    mapping(address => uint256) public lastDrip;

    // ==========================================================================
    // Events
    // ==========================================================================

    event Drip(address indexed recipient, uint256 amount, uint256 nextAvailable);

    // ==========================================================================
    // Constructor
    // ==========================================================================

    /**
     * @param _token Address of the MockERC20 token (USDC)
     * @param _dripAmount Amount to mint per drip (in base units, 6 decimals for USDC)
     * @param _cooldownSeconds Seconds between drips per address
     */
    constructor(
        address _token,
        uint256 _dripAmount,
        uint256 _cooldownSeconds
    ) {
        token = IMintable(_token);
        dripAmount = _dripAmount;
        cooldownSeconds = _cooldownSeconds;
    }

    // ==========================================================================
    // External Functions
    // ==========================================================================

    /**
     * @notice Request tokens from the faucet
     * @dev Mints dripAmount to msg.sender if cooldown has elapsed
     */
    function drip() external {
        require(canDrip(msg.sender), "TokenFaucet: cooldown active");

        lastDrip[msg.sender] = block.timestamp;
        token.mint(msg.sender, dripAmount);

        emit Drip(msg.sender, dripAmount, block.timestamp + cooldownSeconds);
    }

    // ==========================================================================
    // View Functions
    // ==========================================================================

    /**
     * @notice Check if an address can request a drip
     * @param account Address to check
     * @return True if cooldown has elapsed
     */
    function canDrip(address account) public view returns (bool) {
        return block.timestamp >= lastDrip[account] + cooldownSeconds;
    }

    /**
     * @notice Get remaining cooldown seconds for an address
     * @param account Address to check
     * @return Seconds remaining (0 if can drip)
     */
    function cooldownRemaining(address account) public view returns (uint256) {
        uint256 nextAvailable = lastDrip[account] + cooldownSeconds;
        if (block.timestamp >= nextAvailable) {
            return 0;
        }
        return nextAvailable - block.timestamp;
    }
}
```

### Configuration Constants

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `dripAmount` | 1,000 USDC (1_000_000_000 base units) | Enough for meaningful testing |
| `cooldownSeconds` | 60 seconds | Short for dev UX, prevents spam |

## Deployment Integration

### Changes to `scripts/deploy-local.ts`

1. Add `faucet` to `DeploymentAddresses.l1` type
2. Deploy `TokenFaucet` after `MockERC20` (USDC)
3. Save faucet address to `.deployments.local.json`

```typescript
// In DeploymentAddresses.l1 interface
faucet: string;

// Configuration
const FAUCET_DRIP_AMOUNT = "1000000000"; // 1,000 USDC (6 decimals)
const FAUCET_COOLDOWN = "60"; // 60 seconds

// Deploy TokenFaucet after MockERC20 (USDC) deployment
// No role grants needed - MockERC20 has unrestricted mint()
addresses.l1.faucet = deployWithForge(
  "contracts/mocks/TokenFaucet.sol:TokenFaucet",
  [addresses.l1.mockUsdc, FAUCET_DRIP_AMOUNT, FAUCET_COOLDOWN],
  L1_RPC,
  "eth"
);
console.log(`    ✓ Faucet deployed, drips ${Number(FAUCET_DRIP_AMOUNT) / 1_000_000} USDC per request`);
```

### Deployment Output

Addresses are saved to `.deployments.local.json`:

```json
{
  "l1": {
    "mockUsdc": "0x...",
    "faucet": "0x...",
    "mockLendingPool": "0x...",
    ...
  }
}
```

## Frontend Integration

### New Files

| File | Purpose |
|------|---------|
| `frontend/src/services/l1/faucet.ts` | Faucet contract interactions |
| `frontend/src/components/FaucetCard.tsx` | Faucet UI component |

### Service Layer: `faucet.ts`

```typescript
/**
 * Token Faucet Service
 *
 * Provides functions to interact with the TokenFaucet contract
 * for minting test tokens on local devnet.
 */

import type { Address, PublicClient, WalletClient } from "viem";

// ABI for TokenFaucet
export const FAUCET_ABI = [
  {
    type: "function",
    name: "drip",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "canDrip",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "cooldownRemaining",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "dripAmount",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export interface FaucetStatus {
  canDrip: boolean;
  cooldownRemaining: number;
  dripAmount: bigint;
}

export async function getFaucetStatus(
  publicClient: PublicClient,
  faucetAddress: Address,
  userAddress: Address
): Promise<FaucetStatus> {
  const [canDrip, cooldownRemaining, dripAmount] = await Promise.all([
    publicClient.readContract({
      address: faucetAddress,
      abi: FAUCET_ABI,
      functionName: "canDrip",
      args: [userAddress],
    }),
    publicClient.readContract({
      address: faucetAddress,
      abi: FAUCET_ABI,
      functionName: "cooldownRemaining",
      args: [userAddress],
    }),
    publicClient.readContract({
      address: faucetAddress,
      abi: FAUCET_ABI,
      functionName: "dripAmount",
      args: [],
    }),
  ]);

  return {
    canDrip: canDrip as boolean,
    cooldownRemaining: Number(cooldownRemaining as bigint),
    dripAmount: dripAmount as bigint,
  };
}

export async function requestDrip(
  publicClient: PublicClient,
  walletClient: WalletClient,
  faucetAddress: Address
): Promise<`0x${string}`> {
  const txHash = await walletClient.writeContract({
    address: faucetAddress,
    abi: FAUCET_ABI,
    functionName: "drip",
    args: [],
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}
```

### UI Component: `FaucetCard.tsx`

Design principles (following existing patterns):
- Use `Card` with glass variant for visual consistency
- Match input styling from `BridgeFlow`
- Show cooldown countdown with progress indicator
- Integrate with existing state management

```tsx
/**
 * FaucetCard Component
 *
 * Allows users to request test USDC tokens from the faucet.
 * Shows cooldown status and drip amount.
 */

import { createSignal, onCleanup, Show } from "solid-js";
import { useApp } from "../store/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";
import { Progress } from "./ui/progress";

export interface FaucetCardProps {
  onDrip?: () => Promise<void>;
  dripAmount?: bigint;
  cooldownSeconds?: number;
  cooldownRemaining?: number;
  canDrip?: boolean;
}

export function FaucetCard(props: FaucetCardProps) {
  const { state } = useApp();
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [countdown, setCountdown] = createSignal(props.cooldownRemaining ?? 0);

  // Countdown timer
  const timer = setInterval(() => {
    setCountdown((c) => Math.max(0, c - 1));
  }, 1000);
  onCleanup(() => clearInterval(timer));

  const handleDrip = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await props.onDrip?.();
      setCountdown(props.cooldownSeconds ?? 60);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to request tokens");
    } finally {
      setIsLoading(false);
    }
  };

  const formatAmount = (amount: bigint) => {
    return (Number(amount) / 1_000_000).toLocaleString();
  };

  const canRequest = () =>
    state.wallet.l1Address &&
    (props.canDrip ?? countdown() === 0) &&
    !isLoading();

  return (
    <Card variant="glass">
      <CardHeader>
        <CardTitle class="text-lg flex items-center gap-2">
          <span class="text-xl">🚰</span>
          Test Token Faucet
        </CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <Alert>
          <AlertDescription>
            Request {formatAmount(props.dripAmount ?? 1_000_000_000n)} USDC for testing.
            Cooldown: {props.cooldownSeconds ?? 60}s between requests.
          </AlertDescription>
        </Alert>

        <Show when={countdown() > 0}>
          <div class="space-y-2">
            <div class="flex justify-between text-sm text-zinc-400">
              <span>Cooldown</span>
              <span>{countdown()}s remaining</span>
            </div>
            <Progress
              value={((props.cooldownSeconds ?? 60) - countdown()) / (props.cooldownSeconds ?? 60) * 100}
            />
          </div>
        </Show>

        <Show when={error()}>
          <Alert variant="destructive">
            <AlertDescription>{error()}</AlertDescription>
          </Alert>
        </Show>

        <Button
          class="btn-cta w-full"
          disabled={!canRequest()}
          onClick={handleDrip}
        >
          {isLoading() ? "Requesting..." : "Request Test USDC"}
        </Button>

        <Show when={!state.wallet.l1Address}>
          <p class="text-xs text-zinc-500 text-center">
            Connect your ETH wallet to request tokens
          </p>
        </Show>
      </CardContent>
    </Card>
  );
}
```

### App Integration

Add `FaucetCard` to `App.tsx` after the Hero section:

```tsx
{/* Faucet - show only on local devnet */}
<Show when={isLocalDevnet()}>
  <ErrorBoundary>
    <FaucetCard
      onDrip={controller.actions.handleFaucetDrip}
      dripAmount={controller.faucet.dripAmount()}
      cooldownSeconds={controller.faucet.cooldownSeconds()}
      cooldownRemaining={controller.faucet.cooldownRemaining()}
      canDrip={controller.faucet.canDrip()}
    />
  </ErrorBoundary>
</Show>
```

### State Updates

Add to `store/state.ts`:

```typescript
// In AppState type
faucet: {
  address: string | null;
  dripAmount: bigint;
  cooldownSeconds: number;
  cooldownRemaining: number;
  canDrip: boolean;
};

// Initial state
faucet: {
  address: null,
  dripAmount: 0n,
  cooldownSeconds: 60,
  cooldownRemaining: 0,
  canDrip: true,
},
```

## Development Strategy

### Phase 1: Contract (Est. 1-2 hours)

1. Create `eth/contracts/mocks/TokenFaucet.sol`
2. Add unit tests in `eth/test/TokenFaucet.t.sol`
3. Run `make test-l1` to verify

### Phase 2: Deployment (Est. 30 min)

1. Update `DeploymentAddresses` type in `deploy-local.ts`
2. Add faucet deployment after MockERC20
3. Test with `make devnet-clean && make devnet-up`
4. Verify faucet address in `.deployments.local.json`

### Phase 3: Frontend Service (Est. 1 hour)

1. Create `frontend/src/services/l1/faucet.ts`
2. Add faucet ABI and service functions
3. Update `services/deployments.ts` to load faucet address

### Phase 4: Frontend UI (Est. 2 hours)

1. Create `FaucetCard.tsx` component
2. Add faucet state to store
3. Add faucet actions to controller
4. Integrate into `App.tsx`
5. Test end-to-end flow

### Phase 5: Polish (Est. 1 hour)

1. Add loading states and error handling
2. Test edge cases (cooldown, no wallet, etc.)
3. Update CLAUDE.md if needed

## Testing Checklist

### Contract Tests

- [ ] `test_drip_succeeds` - First drip works
- [ ] `test_drip_cooldown` - Reverts during cooldown
- [ ] `test_drip_after_cooldown` - Works after cooldown
- [ ] `test_canDrip_returns_correct_value`
- [ ] `test_cooldownRemaining_returns_correct_value`
- [ ] `test_multiple_users_independent_cooldowns`

### Integration Tests

- [ ] Faucet deployed with correct parameters
- [ ] Faucet address in deployment JSON
- [ ] Frontend loads faucet address from deployments
- [ ] Drip updates user's USDC balance
- [ ] Cooldown UI shows correct countdown
- [ ] Error shown when drip during cooldown
- [ ] Button disabled during transaction

### E2E Tests (Optional)

- [ ] Full flow: Connect wallet → Request drip → See balance update

## Security Considerations

| Risk | Mitigation |
|------|------------|
| Faucet drain | Cooldown limits rate; devnet only |
| Front-running | N/A for testnet |
| Re-entrancy | No external calls after state update |
| Integer overflow | Solidity 0.8+ default checks |

**Note**: This faucet is for **testnet deployments only**. Production deployments should NOT include the faucet or MockERC20 contracts - use real USDC and Aave pools on mainnet.

## Open Questions

1. **Should faucet be deployed on public testnets?**
   - Recommendation: Yes, deploy on Sepolia/Goerli for public testing
   - Consider longer cooldown (e.g., 300s) for public testnets

2. **Should we show faucet in UI for mainnet?**
   - Recommendation: Hide `FaucetCard` when not on testnet (check chainId)

3. **Alternative: Direct MockERC20.mint() from frontend?**
   - Pro: Simpler, no new contract needed
   - Con: No rate limiting, users could spam mint, worse UX (user must enter amount)
   - Decision: Use TokenFaucet wrapper for better UX and rate limiting

## References

- MockERC20 (USDC/aUSDC): `eth/contracts/mocks/MockERC20.sol`
- MockLendingPool: `eth/contracts/mocks/MockLendingPool.sol`
- Deploy script: `scripts/deploy-local.ts`
- Deployment output: `.deployments.local.json`
- Frontend services pattern: `frontend/src/services/l1/tokens.ts`
- UI component pattern: `frontend/src/components/BridgeFlow.tsx`
