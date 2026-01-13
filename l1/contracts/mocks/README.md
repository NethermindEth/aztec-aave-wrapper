# Mock Contracts

Mock implementations for local testing.

## Contracts

### MockERC20.sol
Simple ERC20 token for testing with configurable decimals.

**Features:**
- Configurable decimals
- Unrestricted minting for test setup
- Burn function for cleanup

**Key Functions:**
- `mint(address to, uint256 amount)` - Mint tokens to any address
- `burn(address from, uint256 amount)` - Burn tokens from any address

### MockLendingPool.sol
Mock implementation of Aave V3 Pool for testing.

**Features:**
- Simulates supply/withdraw without interest accrual
- Configurable failure modes for testing error paths
- Tracks deposits per user per asset

**Key Functions:**
- `supply()` - Deposit tokens into the pool
- `withdraw()` - Withdraw tokens from the pool
- `setFailSupply(bool)` - Toggle supply failures for testing
- `setFailWithdraw(bool)` - Toggle withdraw failures for testing
- `setATokenAddress(address, address)` - Configure mock aToken addresses
- `setNormalizedIncome(address, uint256)` - Set yield simulation values

## Limitations

These are TESTING MOCKS ONLY. They:
- Have no security guarantees
- Skip validation present in real contracts
- Should NEVER be used in production
