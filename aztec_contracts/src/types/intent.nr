use dep::aztec::protocol_types::traits::{Deserialize, Serialize};

/// Intent to deposit assets into Aave on a target chain.
///
/// This message is serialized and sent from Aztec L2 to L1 via the cross-chain
/// messaging system. The relayer picks up this intent and executes the deposit
/// on the target chain (e.g., Arbitrum) through the TargetChainExecutor contract.
///
/// Privacy: Uses hash(ownerL2) instead of plain owner address to preserve privacy.
/// The L2 contract stores intentId → owner mapping privately for finalization.
///
/// Fields are ordered for efficient ABI encoding:
/// - Field types (32 bytes each): intent_id, owner_hash, asset
/// - u128 (16 bytes): amount
/// - u8 (1 byte): original_decimals
/// - Smaller types: target_chain_id (u32), deadline (u64)
/// - Field (32 bytes): salt
#[derive(Deserialize, Eq, Serialize)]
pub struct DepositIntent {
    /// Unique identifier for this intent (derived from user address + nonce)
    pub intent_id: Field,
    /// Hash of the L2 owner address for privacy (hash(ownerL2))
    pub owner_hash: Field,
    /// Token address on target chain (stored as Field, cast to address on L1/Target)
    pub asset: Field,
    /// Amount of tokens to deposit (in token's smallest unit)
    pub amount: u128,
    /// Original token decimals for Wormhole denormalization
    pub original_decimals: u8,
    /// Wormhole chain ID of the target chain for deposit
    pub target_chain_id: u32,
    /// Unix timestamp after which this intent expires
    pub deadline: u64,
    /// Random salt for intent uniqueness and replay protection
    pub salt: Field,
}

/// Intent to withdraw assets from Aave on a target chain.
///
/// This message is sent from Aztec L2 to initiate withdrawal of previously
/// deposited assets. The relayer executes the withdrawal and bridges assets
/// back to L2.
///
/// Privacy: Uses hash(ownerL2) for consistency. Full withdrawal only in MVP.
#[derive(Deserialize, Eq, Serialize)]
pub struct WithdrawIntent {
    /// Unique identifier for this intent (must match the original deposit intent)
    pub intent_id: Field,
    /// Hash of the L2 owner address for privacy (hash(ownerL2))
    pub owner_hash: Field,
    /// Amount of aTokens/shares to withdraw (must be full amount for MVP)
    pub amount: u128,
    /// Unix timestamp after which this intent expires
    pub deadline: u64,
}

impl DepositIntent {
    /// Creates a new DepositIntent with the given parameters.
    pub fn new(
        intent_id: Field,
        owner_hash: Field,
        asset: Field,
        amount: u128,
        original_decimals: u8,
        target_chain_id: u32,
        deadline: u64,
        salt: Field,
    ) -> Self {
        Self { intent_id, owner_hash, asset, amount, original_decimals, target_chain_id, deadline, salt }
    }
}

impl WithdrawIntent {
    /// Creates a new WithdrawIntent with the given parameters.
    pub fn new(intent_id: Field, owner_hash: Field, amount: u128, deadline: u64) -> Self {
        Self { intent_id, owner_hash, amount, deadline }
    }
}
