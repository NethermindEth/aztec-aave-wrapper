use dep::aztec::protocol_types::traits::{Deserialize, Serialize};

/// Intent to deposit assets into Aave on a target chain.
///
/// This message is serialized and sent from Aztec L2 to L1 via the cross-chain
/// messaging system. The relayer picks up this intent and executes the deposit
/// on the target chain (e.g., Arbitrum) through the TargetChainExecutor contract.
///
/// Fields are ordered for efficient ABI encoding:
/// - Field types (32 bytes each): intent_id, asset_id
/// - u128 (16 bytes): amount
/// - Smaller types: target_chain_id (u32), deadline (u64), salt (u32)
#[derive(Deserialize, Eq, Serialize)]
pub struct DepositIntent {
    /// Unique identifier for this intent (derived from user address + nonce)
    pub intent_id: Field,
    /// Identifier for the asset being deposited (maps to token address on target chain)
    pub asset_id: Field,
    /// Amount of tokens to deposit (in token's smallest unit)
    pub amount: u128,
    /// Wormhole chain ID of the target chain for deposit
    pub target_chain_id: u32,
    /// Unix timestamp after which this intent expires
    pub deadline: u64,
    /// Random salt for intent uniqueness and replay protection
    pub salt: u32,
}

/// Intent to withdraw assets from Aave on a target chain.
///
/// This message is sent from Aztec L2 to initiate withdrawal of previously
/// deposited assets. The relayer executes the withdrawal and bridges assets
/// back to L2.
#[derive(Deserialize, Eq, Serialize)]
pub struct WithdrawIntent {
    /// Unique identifier for this intent (must match the original deposit intent)
    pub intent_id: Field,
    /// Amount of aTokens/shares to withdraw
    pub amount: u128,
    /// Unix timestamp after which this intent expires
    pub deadline: u64,
}

impl DepositIntent {
    /// Creates a new DepositIntent with the given parameters.
    pub fn new(
        intent_id: Field,
        asset_id: Field,
        amount: u128,
        target_chain_id: u32,
        deadline: u64,
        salt: u32,
    ) -> Self {
        Self { intent_id, asset_id, amount, target_chain_id, deadline, salt }
    }
}

impl WithdrawIntent {
    /// Creates a new WithdrawIntent with the given parameters.
    pub fn new(intent_id: Field, amount: u128, deadline: u64) -> Self {
        Self { intent_id, amount, deadline }
    }
}
