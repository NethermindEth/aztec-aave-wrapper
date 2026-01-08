/// Tests for the withdraw flow of the AaveWrapper contract.
///
/// This module tests:
/// - Withdraw message content hashing (`compute_withdraw_message_content`)
/// - Withdraw confirmation content hashing (`compute_withdraw_confirmation_content`)
/// - WithdrawIntent struct creation and behavior
/// - Position receipt note status transitions
///
/// # Privacy Note
/// The updated functions use secret_hash instead of owner addresses to preserve
/// user privacy. The owner is never revealed in public hashes or L1 messages.

use crate::{compute_withdraw_confirmation_content, compute_withdraw_message_content};
use crate::types::{PositionReceiptNote, PositionStatus, WithdrawIntent};
use dep::aztec::protocol_types::{address::AztecAddress, traits::FromField};

// ============================================================================
// compute_withdraw_message_content Tests
// ============================================================================

/// Test that compute_withdraw_message_content produces consistent hashes.
///
/// This verifies the deterministic behavior of the content hash computation
/// which is critical for L2->L1 message verification.
///
/// # Privacy
/// Uses secret_hash instead of owner - the owner is never revealed on L1.
#[test]
unconstrained fn test_compute_withdraw_message_content_deterministic() {
    let intent = WithdrawIntent::new(
        0x1234567890abcdef, // intent_id
        1000000, // amount
        1700000000, // deadline
    );
    let asset_id: Field = 1;
    let target_chain_id: u32 = 23;
    let secret_hash: Field = 0xabcdef123456;

    // Compute hash twice
    let hash1 = compute_withdraw_message_content(intent, asset_id, target_chain_id, secret_hash);
    let hash2 = compute_withdraw_message_content(intent, asset_id, target_chain_id, secret_hash);

    // Should produce identical hashes
    assert(hash1 == hash2, "Withdraw content hash should be deterministic");
}

/// Test that compute_withdraw_message_content produces different hashes
/// for different inputs.
#[test]
unconstrained fn test_compute_withdraw_message_content_different_inputs() {
    let intent = WithdrawIntent::new(0x1234567890abcdef, 1000000, 1700000000);
    let asset_id: Field = 1;
    let target_chain_id: u32 = 23;
    let secret_hash: Field = 0xdeadbeef;

    let hash1 = compute_withdraw_message_content(intent, asset_id, target_chain_id, secret_hash);

    // Change intent_id
    let intent2 = WithdrawIntent::new(0x9999999999999999, 1000000, 1700000000);
    let hash2 = compute_withdraw_message_content(intent2, asset_id, target_chain_id, secret_hash);

    // Change secret_hash
    let hash3 = compute_withdraw_message_content(intent, asset_id, target_chain_id, 0xcafebabe);

    // Change amount
    let intent4 = WithdrawIntent::new(0x1234567890abcdef, 2000000, 1700000000);
    let hash4 = compute_withdraw_message_content(intent4, asset_id, target_chain_id, secret_hash);

    // Change asset_id
    let hash5 = compute_withdraw_message_content(intent, 2, target_chain_id, secret_hash);

    // Change target_chain_id
    let hash6 = compute_withdraw_message_content(intent, asset_id, 42, secret_hash);

    // Change deadline
    let intent7 = WithdrawIntent::new(0x1234567890abcdef, 1000000, 1800000000);
    let hash7 = compute_withdraw_message_content(intent7, asset_id, target_chain_id, secret_hash);

    // All hashes should be different
    assert(hash1 != hash2, "Different intent_id should produce different hash");
    assert(hash1 != hash3, "Different secret_hash should produce different hash");
    assert(hash1 != hash4, "Different amount should produce different hash");
    assert(hash1 != hash5, "Different asset_id should produce different hash");
    assert(hash1 != hash6, "Different target_chain_id should produce different hash");
    assert(hash1 != hash7, "Different deadline should produce different hash");
    assert(hash2 != hash3, "Hashes should be unique for each input combination");
}

/// Test withdraw message for partial withdrawal.
///
/// Users can withdraw a portion of their shares, keeping the rest active.
#[test]
unconstrained fn test_compute_withdraw_message_partial_withdrawal() {
    let total_shares: u128 = 1_000_000_000; // 1000 aUSDC
    let partial_amount: u128 = 500_000_000; // Withdraw half

    let intent = WithdrawIntent::new(0x1234567890abcdef, partial_amount, 1700000000);
    let asset_id: Field = 1;
    let target_chain_id: u32 = 23;
    let secret_hash: Field = 0xdeadbeef;

    let hash = compute_withdraw_message_content(intent, asset_id, target_chain_id, secret_hash);

    assert(hash != 0, "Partial withdrawal should produce valid hash");

    // Full withdrawal with same parameters should produce different hash
    let full_intent = WithdrawIntent::new(0x1234567890abcdef, total_shares, 1700000000);
    let full_hash =
        compute_withdraw_message_content(full_intent, asset_id, target_chain_id, secret_hash);

    assert(hash != full_hash, "Partial and full withdrawal should produce different hashes");
}

/// Test withdraw message includes deadline for time-bound execution.
#[test]
unconstrained fn test_compute_withdraw_message_deadline_sensitivity() {
    let asset_id: Field = 1;
    let target_chain_id: u32 = 23;
    let secret_hash: Field = 0xdeadbeef;

    // Urgent withdrawal (short deadline)
    let intent_urgent = WithdrawIntent::new(0x123, 1000000, 1700003600); // 1 hour
    let hash_urgent =
        compute_withdraw_message_content(intent_urgent, asset_id, target_chain_id, secret_hash);

    // Patient withdrawal (long deadline)
    let intent_patient = WithdrawIntent::new(0x123, 1000000, 1700604800); // 1 week
    let hash_patient =
        compute_withdraw_message_content(intent_patient, asset_id, target_chain_id, secret_hash);

    assert(hash_urgent != hash_patient, "Different deadlines should produce different hashes");
}

// ============================================================================
// compute_withdraw_confirmation_content Tests
// ============================================================================

/// Test that compute_withdraw_confirmation_content produces consistent hashes.
///
/// This verifies the deterministic behavior of the content hash computation
/// which is critical for L1->L2 message verification in finalize_withdraw.
///
/// # Privacy
/// Note: owner is NOT included in confirmation hash - authentication is via secret.
#[test]
unconstrained fn test_compute_withdraw_confirmation_content_deterministic() {
    let intent_id: Field = 0x1234567890abcdef;
    let asset_id: Field = 1;
    let amount: u128 = 1000000;
    let target_chain_id: u32 = 23;

    // Compute hash twice
    let hash1 = compute_withdraw_confirmation_content(intent_id, asset_id, amount, target_chain_id);
    let hash2 = compute_withdraw_confirmation_content(intent_id, asset_id, amount, target_chain_id);

    // Should produce identical hashes
    assert(hash1 == hash2, "Withdraw confirmation hash should be deterministic");
}

/// Test that compute_withdraw_confirmation_content produces different hashes
/// for different inputs.
#[test]
unconstrained fn test_compute_withdraw_confirmation_content_different_inputs() {
    let intent_id: Field = 0x1234567890abcdef;
    let asset_id: Field = 1;
    let amount: u128 = 1000000;
    let target_chain_id: u32 = 23;

    let hash1 = compute_withdraw_confirmation_content(intent_id, asset_id, amount, target_chain_id);

    // Change intent_id
    let hash2 = compute_withdraw_confirmation_content(
        0x9999999999999999, // Different intent_id
        asset_id,
        amount,
        target_chain_id,
    );

    // Change amount
    let hash3 = compute_withdraw_confirmation_content(
        intent_id,
        asset_id,
        2000000, // Different amount
        target_chain_id,
    );

    // Change asset_id
    let hash4 = compute_withdraw_confirmation_content(
        intent_id,
        2, // Different asset_id
        amount,
        target_chain_id,
    );

    // Change target_chain_id
    let hash5 = compute_withdraw_confirmation_content(
        intent_id,
        asset_id,
        amount,
        42, // Different chain_id
    );

    // All hashes should be different
    assert(hash1 != hash2, "Different intent_id should produce different hash");
    assert(hash1 != hash3, "Different amount should produce different hash");
    assert(hash1 != hash4, "Different asset_id should produce different hash");
    assert(hash1 != hash5, "Different target_chain_id should produce different hash");
    assert(hash2 != hash3, "Hashes should be unique for each input combination");
}

/// Test withdrawal confirmation with accrued interest.
///
/// When withdrawing from Aave, the actual amount received may be greater
/// than the original deposit due to interest accrual.
#[test]
unconstrained fn test_compute_withdraw_confirmation_with_interest() {
    let intent_id: Field = 0xabcdef1234567890;
    let asset_id: Field = 1;
    let original_shares: u128 = 100_000_000; // 100 aUSDC
    // Amount after interest accrual (e.g., 5% APY for 1 year)
    let amount_with_interest: u128 = 105_000_000; // 105 USDC
    let target_chain_id: u32 = 23;

    let hash = compute_withdraw_confirmation_content(
        intent_id,
        asset_id,
        amount_with_interest,
        target_chain_id,
    );

    // Hash should be different from same intent with original amount
    let hash_original = compute_withdraw_confirmation_content(
        intent_id,
        asset_id,
        original_shares,
        target_chain_id,
    );

    assert(hash != hash_original, "Different amounts should produce different hashes");
    assert(hash != 0, "Interest-bearing withdrawal should produce valid hash");
}

// ============================================================================
// WithdrawIntent Struct Tests
// ============================================================================

/// Test WithdrawIntent::new creates struct with correct values.
#[test]
unconstrained fn test_withdraw_intent_new() {
    let intent = WithdrawIntent::new(
        0x1234567890abcdef, // intent_id
        500_000_000, // amount (500 aToken shares)
        1735689600, // deadline
    );

    assert(intent.intent_id == 0x1234567890abcdef, "intent_id mismatch");
    assert(intent.amount == 500_000_000, "amount mismatch");
    assert(intent.deadline == 1735689600, "deadline mismatch");
}

/// Test WithdrawIntent equality comparison.
#[test]
unconstrained fn test_withdraw_intent_equality() {
    let intent1 = WithdrawIntent::new(0x123, 1000, 1700000000);
    let intent2 = WithdrawIntent::new(0x123, 1000, 1700000000);
    let intent3 = WithdrawIntent::new(0x456, 1000, 1700000000);
    let intent4 = WithdrawIntent::new(0x123, 2000, 1700000000);

    assert(intent1 == intent2, "Identical intents should be equal");
    assert(intent1 != intent3, "Different intent_id should not be equal");
    assert(intent1 != intent4, "Different amount should not be equal");
}

/// Test full withdrawal (all shares).
#[test]
unconstrained fn test_withdraw_intent_full_withdrawal() {
    let total_shares: u128 = 1_000_000_000_000_000_000; // 1 aWETH (18 decimals)

    let intent = WithdrawIntent::new(
        0xdeadbeef,
        total_shares, // Full withdrawal
        1700000000,
    );

    assert(intent.amount == total_shares, "Full withdrawal amount should be stored correctly");

    let asset_id: Field = 2; // WETH
    let target_chain_id: u32 = 23;
    let secret_hash: Field = 0xdeadbeef;

    let hash = compute_withdraw_message_content(intent, asset_id, target_chain_id, secret_hash);

    assert(hash != 0, "Full withdrawal should produce valid hash");
}

/// Test minimum withdrawal (dust).
#[test]
unconstrained fn test_withdraw_intent_minimum_withdrawal() {
    let min_amount: u128 = 1; // 1 wei

    let intent = WithdrawIntent::new(0xdeadbeef, min_amount, 1700000000);

    assert(intent.amount == min_amount, "Minimum amount should be stored correctly");

    let secret_hash: Field = 0xdeadbeef;
    let hash = compute_withdraw_message_content(intent, 1, 23, secret_hash);

    assert(hash != 0, "Minimum withdrawal should produce valid hash");
}

// ============================================================================
// PositionReceiptNote Status Tests
// ============================================================================

/// Test PositionStatus constants are correctly defined.
#[test]
unconstrained fn test_position_status_constants() {
    assert(PositionStatus::PENDING_DEPOSIT == 0, "PENDING_DEPOSIT should be 0");
    assert(PositionStatus::ACTIVE == 1, "ACTIVE should be 1");
    assert(PositionStatus::PENDING_WITHDRAW == 2, "PENDING_WITHDRAW should be 2");
}

/// Test PositionReceiptNote status transitions are mutually exclusive.
#[test]
unconstrained fn test_position_status_mutually_exclusive() {
    assert(
        PositionStatus::PENDING_DEPOSIT != PositionStatus::ACTIVE,
        "Statuses should be different",
    );
    assert(
        PositionStatus::ACTIVE != PositionStatus::PENDING_WITHDRAW,
        "Statuses should be different",
    );
    assert(
        PositionStatus::PENDING_DEPOSIT != PositionStatus::PENDING_WITHDRAW,
        "Statuses should be different",
    );
}

/// Test PositionReceiptNote field values for a typical active position.
#[test]
unconstrained fn test_position_receipt_note_active_position() {
    let owner = AztecAddress::from_field(0xdeadbeef);
    let nonce: Field = 0x1234567890abcdef;
    let asset_id: Field = 1;
    let shares: u128 = 100_000_000;
    let target_chain_id: u32 = 23;
    let status: u8 = PositionStatus::ACTIVE;

    let receipt = PositionReceiptNote { owner, nonce, asset_id, shares, target_chain_id, status };

    assert(receipt.owner == owner, "Owner mismatch");
    assert(receipt.nonce == nonce, "Nonce mismatch");
    assert(receipt.asset_id == asset_id, "Asset ID mismatch");
    assert(receipt.shares == shares, "Shares mismatch");
    assert(receipt.target_chain_id == target_chain_id, "Target chain ID mismatch");
    assert(receipt.status == PositionStatus::ACTIVE, "Status should be ACTIVE");
}

/// Test PositionReceiptNote for pending withdrawal state.
#[test]
unconstrained fn test_position_receipt_note_pending_withdraw() {
    let owner = AztecAddress::from_field(0xdeadbeef);
    let nonce: Field = 0x1234567890abcdef;
    let asset_id: Field = 1;
    let remaining_shares: u128 = 50_000_000; // Half shares remaining after partial withdraw request
    let target_chain_id: u32 = 23;
    let status: u8 = PositionStatus::PENDING_WITHDRAW;

    let receipt = PositionReceiptNote {
        owner,
        nonce,
        asset_id,
        shares: remaining_shares,
        target_chain_id,
        status,
    };

    assert(receipt.status == PositionStatus::PENDING_WITHDRAW, "Status should be PENDING_WITHDRAW");
    assert(receipt.shares == remaining_shares, "Remaining shares should be stored");
}

/// Test PositionReceiptNote equality for note comparison.
#[test]
unconstrained fn test_position_receipt_note_equality() {
    let owner = AztecAddress::from_field(0xdeadbeef);

    let receipt1 = PositionReceiptNote {
        owner,
        nonce: 0x123,
        asset_id: 1,
        shares: 1000,
        target_chain_id: 23,
        status: PositionStatus::ACTIVE,
    };

    let receipt2 = PositionReceiptNote {
        owner,
        nonce: 0x123,
        asset_id: 1,
        shares: 1000,
        target_chain_id: 23,
        status: PositionStatus::ACTIVE,
    };

    let receipt3 = PositionReceiptNote {
        owner,
        nonce: 0x456, // Different nonce
        asset_id: 1,
        shares: 1000,
        target_chain_id: 23,
        status: PositionStatus::ACTIVE,
    };

    assert(receipt1 == receipt2, "Identical receipts should be equal");
    assert(receipt1 != receipt3, "Different nonces should not be equal");
}

// ============================================================================
// Cross-Chain Withdrawal Tests
// ============================================================================

/// Test withdrawal from different supported chains.
#[test]
unconstrained fn test_withdraw_from_different_chains() {
    let asset_id: Field = 1;
    let intent = WithdrawIntent::new(0x123, 1000000, 1700000000);
    let secret_hash: Field = 0xdeadbeef;

    // Arbitrum (Wormhole chain ID 23)
    let hash_arb = compute_withdraw_message_content(intent, asset_id, 23, secret_hash);
    // Optimism (Wormhole chain ID 24)
    let hash_opt = compute_withdraw_message_content(intent, asset_id, 24, secret_hash);
    // Base (Wormhole chain ID 30)
    let hash_base = compute_withdraw_message_content(intent, asset_id, 30, secret_hash);

    // All should produce different hashes
    assert(hash_arb != hash_opt, "Different chains should produce different hashes");
    assert(hash_opt != hash_base, "Different chains should produce different hashes");
    assert(hash_arb != hash_base, "Different chains should produce different hashes");
}

/// Test withdrawal of different assets.
#[test]
unconstrained fn test_withdraw_different_assets() {
    let target_chain_id: u32 = 23;
    let intent = WithdrawIntent::new(0x123, 1000000, 1700000000);
    let secret_hash: Field = 0xdeadbeef;

    // USDC withdrawal
    let hash_usdc = compute_withdraw_message_content(intent, 1, target_chain_id, secret_hash);
    // WETH withdrawal
    let hash_weth = compute_withdraw_message_content(intent, 2, target_chain_id, secret_hash);
    // DAI withdrawal
    let hash_dai = compute_withdraw_message_content(intent, 3, target_chain_id, secret_hash);

    // All should produce different hashes
    assert(hash_usdc != hash_weth, "Different assets should produce different hashes");
    assert(hash_weth != hash_dai, "Different assets should produce different hashes");
    assert(hash_usdc != hash_dai, "Different assets should produce different hashes");
}

/// Test that intent_id links deposit and withdrawal.
///
/// The withdrawal intent_id must match the original deposit intent_id
/// to ensure proper position tracking.
#[test]
unconstrained fn test_withdraw_intent_id_matches_deposit() {
    let original_deposit_intent_id: Field = 0xabcdef1234567890;

    // Withdrawal should use the same intent_id
    let withdraw_intent = WithdrawIntent::new(original_deposit_intent_id, 1000000, 1700000000);

    assert(
        withdraw_intent.intent_id == original_deposit_intent_id,
        "Withdrawal intent_id should match deposit intent_id",
    );
}
