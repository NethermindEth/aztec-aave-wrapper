/// Edge case and error condition tests for the AaveWrapper contract.
///
/// This module tests:
/// - Boundary conditions (zero values, max values)
/// - Security properties (hash uniqueness, collision resistance)
/// - Cross-function consistency (deposit vs withdraw hashes)
/// - Field arithmetic edge cases
///
/// # Privacy Note
/// The updated functions use secret_hash instead of owner addresses to preserve
/// user privacy. The owner is never revealed in public hashes or L1 messages.

use crate::{
    compute_deposit_confirmation_content, compute_deposit_message_content, compute_intent_id,
    compute_withdraw_confirmation_content, compute_withdraw_message_content,
};
use crate::types::{DepositIntent, PositionReceiptNote, PositionStatus, WithdrawIntent};
use dep::aztec::protocol_types::{address::AztecAddress, traits::FromField};

// ============================================================================
// Zero Value Edge Cases
// ============================================================================

/// Test that zero values produce valid hashes for intent ID.
#[test]
unconstrained fn test_compute_intent_id_zero_values() {
    let hash = compute_intent_id(AztecAddress::from_field(0), 0, 0, 0, 0, 0);

    // Should not panic and produce a non-zero hash
    // poseidon2 of zeros still produces a non-zero result
    assert(hash != 0, "Intent ID of zeros should be non-zero");
}

/// Test that zero values produce valid hashes for deposit message.
#[test]
unconstrained fn test_compute_deposit_message_content_zero_values() {
    let intent = DepositIntent::new(0, 0, 0, 0, 0, 0);
    let secret_hash: Field = 0;

    let hash = compute_deposit_message_content(intent, secret_hash);

    assert(hash != 0, "Deposit message hash of zeros should be non-zero");
}

/// Test that zero values produce valid hashes for deposit confirmation.
#[test]
unconstrained fn test_compute_deposit_confirmation_content_zero_values() {
    let hash = compute_deposit_confirmation_content(0, 0, 0, 0);

    assert(hash != 0, "Deposit confirmation hash of zeros should be non-zero");
}

/// Test that zero values produce valid hashes for withdraw message.
#[test]
unconstrained fn test_compute_withdraw_message_content_zero_values() {
    let intent = WithdrawIntent::new(0, 0, 0);
    let hash = compute_withdraw_message_content(intent, 0, 0, 0);

    assert(hash != 0, "Withdraw message hash of zeros should be non-zero");
}

/// Test that zero values produce valid hashes for withdraw confirmation.
#[test]
unconstrained fn test_compute_withdraw_confirmation_content_zero_values() {
    let hash = compute_withdraw_confirmation_content(0, 0, 0, 0);

    assert(hash != 0, "Withdraw confirmation hash of zeros should be non-zero");
}

// ============================================================================
// Maximum Value Edge Cases
// ============================================================================

/// Test max value handling for u128 shares in deposit confirmation.
#[test]
unconstrained fn test_compute_deposit_confirmation_content_max_shares() {
    let intent_id: Field = 0x1234567890abcdef;
    let asset_id: Field = 1;
    let max_shares: u128 = 0xffffffffffffffffffffffffffffffff; // Max u128
    let target_chain_id: u32 = 23;

    // Should not overflow or panic
    let hash =
        compute_deposit_confirmation_content(intent_id, asset_id, max_shares, target_chain_id);

    assert(hash != 0, "Hash should be computed for max shares");
}

/// Test max value handling for u128 amount in withdrawal.
#[test]
unconstrained fn test_compute_withdraw_message_content_max_amount() {
    let max_amount: u128 = 0xffffffffffffffffffffffffffffffff; // Max u128
    let intent = WithdrawIntent::new(0x1234567890abcdef, max_amount, 1700000000);
    let asset_id: Field = 1;
    let target_chain_id: u32 = 23;
    let secret_hash: Field = 0xdeadbeef;

    // Should not overflow or panic
    let hash = compute_withdraw_message_content(intent, asset_id, target_chain_id, secret_hash);

    assert(hash != 0, "Hash should be computed for max amount");
}

/// Test max value handling for u128 amount in withdraw confirmation.
#[test]
unconstrained fn test_compute_withdraw_confirmation_content_max_amount() {
    let intent_id: Field = 0x1234567890abcdef;
    let asset_id: Field = 1;
    let max_amount: u128 = 0xffffffffffffffffffffffffffffffff; // Max u128
    let target_chain_id: u32 = 23;

    // Should not overflow or panic
    let hash =
        compute_withdraw_confirmation_content(intent_id, asset_id, max_amount, target_chain_id);

    assert(hash != 0, "Hash should be computed for max amount");
}

/// Test max value handling for intent ID computation with extreme values.
///
/// Note: Field values are bounded by the BN254 modulus, not 2^256.
/// We use large but valid values for the Field types.
#[test]
unconstrained fn test_compute_intent_id_max_values() {
    // Use a large but valid field value (well under the BN254 modulus)
    let caller = AztecAddress::from_field(0x1234567890abcdef1234567890abcdef12345678);
    let asset_id: Field = 0x9999999999999999999999999999999999999999;
    let max_amount: u128 = 0xffffffffffffffffffffffffffffffff; // Max u128
    let max_chain_id: u32 = 0xffffffff; // Max u32
    let max_deadline: u64 = 0xffffffffffffffff; // Max u64
    let max_salt: u32 = 0xffffffff; // Max u32

    // Should not overflow or panic
    let hash = compute_intent_id(
        caller,
        asset_id,
        max_amount,
        max_chain_id,
        max_deadline,
        max_salt,
    );

    assert(hash != 0, "Intent ID should be computed for max values");
}

/// Test maximum chain ID value.
#[test]
unconstrained fn test_max_chain_id() {
    let secret_hash: Field = 0xdeadbeef;
    let intent = DepositIntent::new(0x123, 1, 1000, 0xffffffff, 1700000000, 1);

    let hash = compute_deposit_message_content(intent, secret_hash);

    assert(hash != 0, "Max chain ID should produce valid hash");
}

/// Test maximum deadline value.
#[test]
unconstrained fn test_max_deadline() {
    let secret_hash: Field = 0xdeadbeef;
    let max_deadline: u64 = 0xffffffffffffffff;
    let intent = DepositIntent::new(0x123, 1, 1000, 23, max_deadline, 1);

    let hash = compute_deposit_message_content(intent, secret_hash);

    assert(hash != 0, "Max deadline should produce valid hash");
}

// ============================================================================
// Security Properties - Hash Collision Resistance
// ============================================================================

/// Test that different callers produce different intent IDs.
///
/// This is critical security property - prevents front-running attacks.
#[test]
unconstrained fn test_intent_id_caller_binding() {
    let asset_id: Field = 1;
    let amount: u128 = 1000000;
    let target_chain_id: u32 = 23;
    let deadline: u64 = 1700000000;
    let salt: u32 = 12345;

    let caller1 = AztecAddress::from_field(0x1111111111111111);
    let caller2 = AztecAddress::from_field(0x2222222222222222);

    let hash1 = compute_intent_id(caller1, asset_id, amount, target_chain_id, deadline, salt);
    let hash2 = compute_intent_id(caller2, asset_id, amount, target_chain_id, deadline, salt);

    // An attacker cannot use someone else's intent
    assert(hash1 != hash2, "Different callers must produce different intent IDs");
}

/// Test that deposit confirmation hash differs for different inputs.
///
/// # Privacy Note
/// Confirmation hashes no longer include owner - authentication is via secret.
#[test]
unconstrained fn test_deposit_confirmation_different_inputs() {
    let intent_id: Field = 0x1234567890abcdef;
    let asset_id: Field = 1;
    let shares: u128 = 1000000;
    let target_chain_id: u32 = 23;

    let hash1 = compute_deposit_confirmation_content(intent_id, asset_id, shares, target_chain_id);
    let hash2 = compute_deposit_confirmation_content(intent_id, 2, shares, target_chain_id); // Different asset

    assert(hash1 != hash2, "Different inputs must produce different confirmation hashes");
}

/// Test that withdraw message hash is bound to secret_hash.
///
/// # Privacy Note
/// The secret_hash binds the message to whoever knows the secret,
/// without revealing the owner's identity.
#[test]
unconstrained fn test_withdraw_message_secret_binding() {
    let intent = WithdrawIntent::new(0x1234567890abcdef, 1000000, 1700000000);
    let asset_id: Field = 1;
    let target_chain_id: u32 = 23;

    let secret_hash1: Field = 0x1111111111111111;
    let secret_hash2: Field = 0x2222222222222222;

    let hash1 = compute_withdraw_message_content(intent, asset_id, target_chain_id, secret_hash1);
    let hash2 = compute_withdraw_message_content(intent, asset_id, target_chain_id, secret_hash2);

    assert(hash1 != hash2, "Different secret_hashes must produce different withdraw hashes");
}

/// Test hash collision resistance with similar inputs.
///
/// Even slightly different inputs should produce completely different hashes.
#[test]
unconstrained fn test_hash_collision_resistance_similar_inputs() {
    let secret_hash: Field = 0xdeadbeef;

    // Two intents that differ only by 1 in amount
    let intent1 = DepositIntent::new(0x123, 1, 1000000, 23, 1700000000, 1);
    let intent2 = DepositIntent::new(0x123, 1, 1000001, 23, 1700000000, 1);

    let hash1 = compute_deposit_message_content(intent1, secret_hash);
    let hash2 = compute_deposit_message_content(intent2, secret_hash);

    assert(hash1 != hash2, "Similar inputs must produce different hashes");

    // Two intents that differ only by 1 in deadline
    let intent3 = DepositIntent::new(0x123, 1, 1000000, 23, 1700000000, 1);
    let intent4 = DepositIntent::new(0x123, 1, 1000000, 23, 1700000001, 1);

    let hash3 = compute_deposit_message_content(intent3, secret_hash);
    let hash4 = compute_deposit_message_content(intent4, secret_hash);

    assert(hash3 != hash4, "Similar inputs must produce different hashes");
}

// ============================================================================
// Cross-Function Consistency Tests
// ============================================================================

/// Test that deposit and withdraw confirmation hashes are identical for same inputs.
///
/// This is intentional - they use the same hash function. The context (intent
/// status) distinguishes them, not the hash value itself.
#[test]
unconstrained fn test_withdraw_vs_deposit_confirmation_content() {
    let intent_id: Field = 0x1234567890abcdef;
    let asset_id: Field = 1;
    let amount: u128 = 1000000;
    let target_chain_id: u32 = 23;

    // Note: Both functions use the same input fields but should produce same hash
    // because they have identical implementations (amount/shares are equivalent)
    let deposit_hash = compute_deposit_confirmation_content(
        intent_id,
        asset_id,
        amount, // "shares" in deposit context
        target_chain_id,
    );

    let withdraw_hash = compute_withdraw_confirmation_content(
        intent_id,
        asset_id,
        amount, // "amount" in withdraw context
        target_chain_id,
    );

    // They should actually be equal since the hash function is the same
    // This is intentional - it's the context (intent status) that distinguishes them
    assert(deposit_hash == withdraw_hash, "Same inputs should produce same hash");
}

/// Test that deposit message hash differs from deposit confirmation hash.
///
/// These represent different stages of the deposit flow and must be different.
#[test]
unconstrained fn test_deposit_message_vs_confirmation_different() {
    let secret_hash: Field = 0xdeadbeef;
    let intent_id: Field = 0x1234567890abcdef;
    let asset_id: Field = 1;
    let amount: u128 = 1000000;
    let target_chain_id: u32 = 23;
    let deadline: u64 = 1700000000;
    let salt: u32 = 12345;

    let intent = DepositIntent::new(intent_id, asset_id, amount, target_chain_id, deadline, salt);

    let message_hash = compute_deposit_message_content(intent, secret_hash);
    let confirmation_hash =
        compute_deposit_confirmation_content(intent_id, asset_id, amount, target_chain_id);

    // These must be different because message includes deadline, salt, and secret_hash
    // while confirmation only includes intent_id, asset_id, shares, target_chain_id
    assert(
        message_hash != confirmation_hash,
        "Deposit message and confirmation hashes must differ",
    );
}

/// Test that withdraw message hash differs from withdraw confirmation hash.
#[test]
unconstrained fn test_withdraw_message_vs_confirmation_different() {
    let secret_hash: Field = 0xdeadbeef;
    let intent_id: Field = 0x1234567890abcdef;
    let asset_id: Field = 1;
    let amount: u128 = 1000000;
    let target_chain_id: u32 = 23;
    let deadline: u64 = 1700000000;

    let intent = WithdrawIntent::new(intent_id, amount, deadline);

    let message_hash =
        compute_withdraw_message_content(intent, asset_id, target_chain_id, secret_hash);
    let confirmation_hash =
        compute_withdraw_confirmation_content(intent_id, asset_id, amount, target_chain_id);

    // These must be different because message includes deadline and secret_hash
    // while confirmation does not
    assert(
        message_hash != confirmation_hash,
        "Withdraw message and confirmation hashes must differ",
    );
}

// ============================================================================
// Intent Struct Edge Cases
// ============================================================================

/// Test DepositIntent with all max values.
#[test]
unconstrained fn test_deposit_intent_all_max_values() {
    let intent = DepositIntent::new(
        0xffffffffffffffffffffffffffffff, // Large but valid intent_id
        0xffffffffffffffffffffffffffffff, // Large but valid asset_id
        0xffffffffffffffffffffffffffffffff, // Max u128
        0xffffffff, // Max u32
        0xffffffffffffffff, // Max u64
        0xffffffff, // Max u32
    );

    assert(intent.amount == 0xffffffffffffffffffffffffffffffff, "Max amount should be stored");
    assert(intent.target_chain_id == 0xffffffff, "Max chain_id should be stored");
    assert(intent.deadline == 0xffffffffffffffff, "Max deadline should be stored");
    assert(intent.salt == 0xffffffff, "Max salt should be stored");
}

/// Test WithdrawIntent with all max values.
#[test]
unconstrained fn test_withdraw_intent_all_max_values() {
    let intent = WithdrawIntent::new(
        0xffffffffffffffffffffffffffffff, // Large but valid intent_id
        0xffffffffffffffffffffffffffffffff, // Max u128
        0xffffffffffffffff, // Max u64
    );

    assert(intent.amount == 0xffffffffffffffffffffffffffffffff, "Max amount should be stored");
    assert(intent.deadline == 0xffffffffffffffff, "Max deadline should be stored");
}

// ============================================================================
// PositionReceiptNote Edge Cases
// ============================================================================

/// Test PositionReceiptNote with zero shares.
///
/// This can occur after a full withdrawal is finalized.
#[test]
unconstrained fn test_position_receipt_note_zero_shares() {
    let receipt = PositionReceiptNote {
        owner: AztecAddress::from_field(0xdeadbeef),
        nonce: 0x123,
        asset_id: 1,
        shares: 0, // Fully withdrawn
        target_chain_id: 23,
        status: PositionStatus::ACTIVE, // Or could be PENDING_WITHDRAW
    };

    assert(receipt.shares == 0, "Zero shares should be valid");
}

/// Test PositionReceiptNote with max shares.
#[test]
unconstrained fn test_position_receipt_note_max_shares() {
    let max_shares: u128 = 0xffffffffffffffffffffffffffffffff;

    let receipt = PositionReceiptNote {
        owner: AztecAddress::from_field(0xdeadbeef),
        nonce: 0x123,
        asset_id: 1,
        shares: max_shares,
        target_chain_id: 23,
        status: PositionStatus::ACTIVE,
    };

    assert(receipt.shares == max_shares, "Max shares should be stored correctly");
}

/// Test PositionReceiptNote with max chain ID.
#[test]
unconstrained fn test_position_receipt_note_max_chain_id() {
    let receipt = PositionReceiptNote {
        owner: AztecAddress::from_field(0xdeadbeef),
        nonce: 0x123,
        asset_id: 1,
        shares: 1000000,
        target_chain_id: 0xffffffff,
        status: PositionStatus::ACTIVE,
    };

    assert(receipt.target_chain_id == 0xffffffff, "Max chain_id should be stored correctly");
}

// ============================================================================
// Hash Input Ordering Tests
// ============================================================================

/// Test that hash input order matters for intent ID.
///
/// Swapping arguments should produce different hashes.
#[test]
unconstrained fn test_intent_id_input_order_matters() {
    let addr1 = AztecAddress::from_field(0x1111);
    let addr2 = AztecAddress::from_field(0x2222);

    // Same values but caller/asset_id positions effectively swapped
    // (using asset_id as caller field value and vice versa)
    let hash1 = compute_intent_id(addr1, 0x2222, 1000, 23, 1700000000, 1);
    let hash2 = compute_intent_id(addr2, 0x1111, 1000, 23, 1700000000, 1);

    // These should be different because the inputs are in different positions
    assert(hash1 != hash2, "Input order should affect hash");
}

/// Test that hash input order matters for deposit confirmation.
#[test]
unconstrained fn test_deposit_confirmation_input_order_matters() {
    // Swap intent_id and asset_id values
    let hash1 = compute_deposit_confirmation_content(0x111, 0x222, 1000, 23);
    let hash2 = compute_deposit_confirmation_content(0x222, 0x111, 1000, 23);

    assert(hash1 != hash2, "Input order should affect hash");
}

// ============================================================================
// Realistic Attack Vector Tests
// ============================================================================

/// Test that minimal differences prevent replay attacks.
///
/// An attacker trying to replay with slightly modified parameters
/// should get a completely different hash.
#[test]
unconstrained fn test_replay_protection_minimal_difference() {
    let caller = AztecAddress::from_field(0xdeadbeef);

    // Original intent
    let hash1 = compute_intent_id(caller, 1, 1000000, 23, 1700000000, 42);

    // Attacker tries same intent with salt incremented by 1
    let hash2 = compute_intent_id(caller, 1, 1000000, 23, 1700000000, 43);

    assert(hash1 != hash2, "Different salt must prevent replay");
}

/// Test that past deadline doesn't affect hash calculation.
///
/// The hash is computed the same regardless of whether deadline has passed.
/// Deadline enforcement is done in the execution layer, not in hashing.
#[test]
unconstrained fn test_deadline_in_hash_regardless_of_expiry() {
    let caller = AztecAddress::from_field(0xdeadbeef);

    // Past deadline (Unix timestamp 0 = 1970)
    let hash_past = compute_intent_id(caller, 1, 1000000, 23, 0, 1);

    // Future deadline
    let hash_future = compute_intent_id(caller, 1, 1000000, 23, 9999999999, 1);

    // Both should produce valid, different hashes
    assert(hash_past != 0, "Past deadline should produce valid hash");
    assert(hash_future != 0, "Future deadline should produce valid hash");
    assert(hash_past != hash_future, "Different deadlines produce different hashes");
}

/// Test front-running resistance with nonce/salt.
///
/// Even if an attacker observes an intent, they cannot predict
/// future intent IDs because they don't know the nonce.
#[test]
unconstrained fn test_front_running_resistance() {
    let victim = AztecAddress::from_field(0xaabbccdd11223344);
    let attacker = AztecAddress::from_field(0x55667788aabbccdd);

    // Victim's intent with their salt (derived from nonce)
    let victim_intent_id = compute_intent_id(victim, 1, 1000000, 23, 1700000000, 42);

    // Attacker trying to front-run with same parameters but their address
    let attacker_attempt = compute_intent_id(attacker, 1, 1000000, 23, 1700000000, 42);

    // Attacker cannot create the same intent_id
    assert(victim_intent_id != attacker_attempt, "Attacker cannot replicate victim's intent ID");
}
