use dep::aztec::{
    macros::notes::note,
    protocol_types::{address::AztecAddress, traits::{Deserialize, Packable, Serialize}},
};

/// Represents a user's claim on an Aave position bridged from Aztec L2.
///
/// This private note tracks ownership of deposited assets on L1 Aave.
/// The note is created after a successful deposit confirmation and nullified upon withdrawal.
///
/// Status values:
/// - 0: PendingDeposit - Deposit initiated, awaiting L1 confirmation
/// - 1: Active - Position is active on L1 Aave pool
/// - 2: PendingWithdraw - Withdrawal initiated, awaiting completion
#[derive(Deserialize, Eq, Packable, Serialize)]
#[note]
pub struct PositionReceiptNote {
    /// The Aztec address that owns this position receipt
    pub owner: AztecAddress,
    /// Unique nonce to prevent note collision
    pub nonce: Field,
    /// Identifier for the underlying asset (e.g., USDC, WETH)
    pub asset_id: Field,
    /// Number of shares/aTokens held in the Aave position
    pub shares: u128,
    /// Optional Aave market identifier (set to 0 if not used)
    pub aave_market_id: Field,
    /// Current status of the position (0=PendingDeposit, 1=Active, 2=PendingWithdraw)
    pub status: u8,
}

/// Status constants for PositionReceiptNote
pub mod PositionStatus {
    /// Deposit has been requested but not yet confirmed on L1
    pub global PENDING_DEPOSIT: u8 = 0;
    /// Position is active and earning yield on L1
    pub global ACTIVE: u8 = 1;
    /// Withdrawal has been requested but not yet completed
    pub global PENDING_WITHDRAW: u8 = 2;
}
