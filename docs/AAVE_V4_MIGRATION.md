# Aave V3 → V4 Migration Guide

This document outlines the changes required to update the Aztec Aave Wrapper from Aave V3 to Aave V4.

## Overview

Aave V4 represents a fundamental architectural shift from V3:

| Aspect | V3 | V4 |
|--------|----|----|
| **Architecture** | Monolithic `Pool` contract | Hub-and-Spoke model |
| **Asset Reference** | `address asset` | `uint256 reserveId` |
| **Return Values** | Single values | `(uint256 shares, uint256 assets)` tuples |
| **Referral System** | `uint16 referralCode` parameter | Removed |
| **Share Accounting** | Basic aTokens | Virtual shares (security hardened) |

---

## L1 Portal Changes Required

### 1. Interface Updates

Replace `ILendingPool.sol` with V4's `ISpoke` and `IHub` interfaces.

#### V3 Interface (Current)

```solidity
interface ILendingPool {
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) external;

    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256);

    function getReserveData(address asset) external view returns (
        // 15 return values, aTokenAddress at index 8
    );
}
```

#### V4 Interface (New)

```solidity
interface ISpoke {
    function supply(
        uint256 reserveId,
        uint256 amount,
        address onBehalfOf
    ) external returns (uint256 sharesAmount, uint256 assetAmount);

    function withdraw(
        uint256 reserveId,
        uint256 amount,
        address onBehalfOf
    ) external returns (uint256 sharesAmount, uint256 assetAmount);
}

interface IHub {
    function getReserveData(uint256 reserveId) external view returns (
        address underlyingAsset,
        address shareToken,
        uint256 totalLiquidity,
        uint256 totalShares,
        uint256 utilizationRate
    );

    function getReserveId(address asset) external view returns (uint256);
}
```

### 2. AztecAavePortalL1.sol Changes

#### State Variables

```solidity
// REMOVE
- address public immutable aavePool;

// ADD
+ address public immutable aaveSpoke;
+ address public immutable aaveHub;
```

#### Constructor

```solidity
// BEFORE
constructor(..., address _aavePool, ...) {
    aavePool = _aavePool;
}

// AFTER
constructor(..., address _aaveSpoke, address _aaveHub, ...) {
    aaveSpoke = _aaveSpoke;
    aaveHub = _aaveHub;
}
```

#### Helper Functions

```solidity
// REMOVE
- function _getATokenAddress(address asset) internal view returns (address) {
-     (,,,,,,,, address aTokenAddress,,,,,,) = ILendingPool(aavePool).getReserveData(asset);
-     return aTokenAddress;
- }

// ADD
+ function _getReserveId(address asset) internal view returns (uint256) {
+     return IHub(aaveHub).getReserveId(asset);
+ }
+
+ function _getShareTokenAddress(uint256 reserveId) internal view returns (address) {
+     (, address shareToken,,,) = IHub(aaveHub).getReserveData(reserveId);
+     return shareToken;
+ }
```

#### Supply Operation (in executeDeposit)

```solidity
// BEFORE (V3)
address aToken = _getATokenAddress(intent.asset);
uint256 aTokenBalanceBefore = IERC20(aToken).balanceOf(address(this));
IERC20(intent.asset).approve(aavePool, intent.amount);
ILendingPool(aavePool).supply(intent.asset, intent.amount, address(this), 0);
uint256 shares = IERC20(aToken).balanceOf(address(this)) - aTokenBalanceBefore;

// AFTER (V4)
uint256 reserveId = _getReserveId(intent.asset);
IERC20(intent.asset).approve(aaveSpoke, intent.amount);
(uint256 shares, ) = ISpoke(aaveSpoke).supply(reserveId, intent.amount, address(this));
```

#### Withdraw Operation (in executeWithdraw)

```solidity
// BEFORE (V3)
uint256 withdrawnAmount = ILendingPool(aavePool).withdraw(asset, shares, address(this));

// AFTER (V4)
uint256 reserveId = _getReserveId(asset);
address shareToken = _getShareTokenAddress(reserveId);
IERC20(shareToken).approve(aaveSpoke, shares);
(, uint256 withdrawnAmount) = ISpoke(aaveSpoke).withdraw(reserveId, shares, address(this));
```

---

## Mock Contracts for V4

### MockAaveV4Spoke.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "./MockERC20.sol";

contract MockAaveV4Spoke {
    // Virtual amounts for share calculation (matches V4's anti-manipulation design)
    uint256 public constant VIRTUAL_ASSETS = 1e6;
    uint256 public constant VIRTUAL_SHARES = 1e6;

    address public hub;

    // reserveId => underlying asset
    mapping(uint256 => address) public reserveAssets;
    // reserveId => share token (aToken equivalent)
    mapping(uint256 => address) public reserveShareTokens;
    // reserveId => total assets
    mapping(uint256 => uint256) public totalAssets;
    // reserveId => total shares
    mapping(uint256 => uint256) public totalShares;

    // Test control flags
    bool public failSupply;
    bool public failWithdraw;

    event Supply(uint256 indexed reserveId, address indexed onBehalfOf, uint256 shares, uint256 assets);
    event Withdraw(uint256 indexed reserveId, address indexed onBehalfOf, uint256 shares, uint256 assets);

    function configureReserve(
        uint256 reserveId,
        address asset,
        address shareToken
    ) external {
        reserveAssets[reserveId] = asset;
        reserveShareTokens[reserveId] = shareToken;
    }

    function supply(
        uint256 reserveId,
        uint256 amount,
        address onBehalfOf
    ) external returns (uint256 sharesAmount, uint256 assetAmount) {
        require(!failSupply, "MockAaveV4Spoke: supply failed");

        address asset = reserveAssets[reserveId];
        address shareToken = reserveShareTokens[reserveId];
        require(asset != address(0), "MockAaveV4Spoke: reserve not configured");

        // Transfer underlying asset from caller
        IERC20(asset).transferFrom(msg.sender, address(this), amount);

        // Calculate shares using V4's virtual accounting formula
        uint256 currentTotalAssets = totalAssets[reserveId];
        uint256 currentTotalShares = totalShares[reserveId];

        sharesAmount = (amount * (currentTotalShares + VIRTUAL_SHARES)) /
                       (currentTotalAssets + VIRTUAL_ASSETS);

        // Update state
        totalAssets[reserveId] += amount;
        totalShares[reserveId] += sharesAmount;

        // Mint share tokens
        MockERC20(shareToken).mint(onBehalfOf, sharesAmount);

        assetAmount = amount;
        emit Supply(reserveId, onBehalfOf, sharesAmount, assetAmount);
    }

    function withdraw(
        uint256 reserveId,
        uint256 shares,
        address onBehalfOf
    ) external returns (uint256 sharesAmount, uint256 assetAmount) {
        require(!failWithdraw, "MockAaveV4Spoke: withdraw failed");

        address asset = reserveAssets[reserveId];
        address shareToken = reserveShareTokens[reserveId];
        require(asset != address(0), "MockAaveV4Spoke: reserve not configured");

        // Calculate assets from shares using V4's virtual accounting
        uint256 currentTotalAssets = totalAssets[reserveId];
        uint256 currentTotalShares = totalShares[reserveId];

        assetAmount = (shares * (currentTotalAssets + VIRTUAL_ASSETS)) /
                      (currentTotalShares + VIRTUAL_SHARES);

        // Burn share tokens
        MockERC20(shareToken).burn(msg.sender, shares);

        // Update state
        totalAssets[reserveId] -= assetAmount;
        totalShares[reserveId] -= shares;

        // Transfer underlying back
        IERC20(asset).transfer(onBehalfOf, assetAmount);

        sharesAmount = shares;
        emit Withdraw(reserveId, onBehalfOf, sharesAmount, assetAmount);
    }

    // Simulate yield accrual (increases totalAssets without changing shares)
    function accrueYield(uint256 reserveId, uint256 yieldAmount) external {
        totalAssets[reserveId] += yieldAmount;
    }

    // Test helpers
    function setFailSupply(bool _fail) external { failSupply = _fail; }
    function setFailWithdraw(bool _fail) external { failWithdraw = _fail; }
}
```

### MockAaveV4Hub.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

contract MockAaveV4Hub {
    struct ReserveData {
        address underlyingAsset;
        address shareToken;
        uint256 totalLiquidity;
        uint256 totalShares;
        uint256 utilizationRate;
    }

    mapping(uint256 => ReserveData) public reserves;
    mapping(address => uint256) public assetToReserveId;
    uint256 public nextReserveId = 1;

    function addReserve(address asset, address shareToken) external returns (uint256 reserveId) {
        reserveId = nextReserveId++;
        reserves[reserveId] = ReserveData({
            underlyingAsset: asset,
            shareToken: shareToken,
            totalLiquidity: 0,
            totalShares: 0,
            utilizationRate: 0
        });
        assetToReserveId[asset] = reserveId;
    }

    function getReserveData(uint256 reserveId) external view returns (
        address underlyingAsset,
        address shareToken,
        uint256 totalLiquidity,
        uint256 totalShares,
        uint256 utilizationRate
    ) {
        ReserveData storage data = reserves[reserveId];
        return (
            data.underlyingAsset,
            data.shareToken,
            data.totalLiquidity,
            data.totalShares,
            data.utilizationRate
        );
    }

    function getReserveId(address asset) external view returns (uint256) {
        return assetToReserveId[asset];
    }
}
```

---

## L2 Noir Contract Changes

The L2 contracts are **mostly version-agnostic** since they deal with intents and messages rather than direct Aave interaction. No changes are required for MVP.

### Optional Enhancement: Reserve ID Support

For future flexibility, you could add a `reserve_id` field to intents:

```noir
pub struct DepositIntent {
    pub intent_id: Field,
    pub owner_hash: Field,
    pub asset: Field,           // Keep for backward compatibility
    pub reserve_id: u64,        // NEW: V4 reserve ID (optional, 0 = use asset lookup)
    pub amount: u128,
    pub original_decimals: u8,
    pub deadline: u64,
    pub salt: Field,
}
```

However, for MVP this is **not required** - the L1 portal performs the `asset → reserveId` lookup internally.

---

## Test Updates

### Portal.t.sol Setup Changes

```solidity
// BEFORE
MockLendingPool mockAave;

function setUp() public {
    mockAave = new MockLendingPool();
    portal = new AztecAavePortalL1(
        ...,
        address(mockAave),
        ...
    );
}

// AFTER
MockAaveV4Spoke mockSpoke;
MockAaveV4Hub mockHub;

function setUp() public {
    mockSpoke = new MockAaveV4Spoke();
    mockHub = new MockAaveV4Hub();

    // Configure USDC reserve
    uint256 usdcReserveId = mockHub.addReserve(address(usdc), address(aUsdc));
    mockSpoke.configureReserve(usdcReserveId, address(usdc), address(aUsdc));

    portal = new AztecAavePortalL1(
        ...,
        address(mockSpoke),
        address(mockHub),
        ...
    );
}
```

---

## Migration Checklist

### L1 (Solidity) - Required Changes

| File | Change | Priority |
|------|--------|----------|
| `interfaces/ILendingPool.sol` | Replace with `ISpoke.sol` and `IHub.sol` | High |
| `AztecAavePortalL1.sol` | Update constructor, supply/withdraw calls | High |
| `mocks/MockLendingPool.sol` | Replace with `MockAaveV4Spoke.sol` + `MockAaveV4Hub.sol` | High |
| `test/Portal.t.sol` | Update setup and mock usage | High |

### L2 (Noir) - Optional Changes

| File | Change | Priority |
|------|--------|----------|
| `types/intent.nr` | Add `reserve_id` field (optional) | Low |
| `main.nr` | Update message content if reserve_id added | Low |

### New Files to Create

1. `eth/contracts/interfaces/ISpoke.sol` - V4 Spoke interface
2. `eth/contracts/interfaces/IHub.sol` - V4 Hub interface
3. `eth/contracts/mocks/MockAaveV4Spoke.sol` - Spoke mock with virtual accounting
4. `eth/contracts/mocks/MockAaveV4Hub.sol` - Hub mock for reserve configuration

---

## Key V4 Concepts

### Virtual Accounting

V4 uses virtual amounts to prevent share manipulation attacks:

```solidity
const VIRTUAL_ASSETS = 1e6;
const VIRTUAL_SHARES = 1e6;

// Asset → Share conversion
shares = (amount × (totalShares + VIRTUAL_SHARES)) / (totalAssets + VIRTUAL_ASSETS)

// Share → Asset conversion
assets = (shares × (totalAssets + VIRTUAL_ASSETS)) / (totalShares + VIRTUAL_SHARES)
```

### Hub-and-Spoke Architecture

- **Hub**: Central immutable liquidity coordinator managing pools across all spokes
- **Spoke**: Upgradeable, asset-specific modules handling user-facing operations

### Dual Return Values

All V4 operations return `(shares, assets)` tuples for better accounting transparency:

```solidity
(uint256 shares, uint256 assets) = spoke.supply(reserveId, amount, onBehalfOf);
(uint256 shares, uint256 assets) = spoke.withdraw(reserveId, amount, onBehalfOf);
```

---

## Mainnet Deployment Considerations

When deploying to mainnet with real Aave V4:

1. **Obtain official addresses**: Get the deployed Spoke and Hub addresses from Aave governance
2. **Verify reserve IDs**: Confirm the reserveId for USDC (and other supported assets)
3. **Test on testnet first**: Deploy against Aave V4 testnet deployment
4. **Remove mock-specific code**: Ensure no test helpers leak into production
5. **Verify interface compatibility**: Compare mock interfaces against official Aave V4 ABIs
