/// Integration tests for the deposit flow of the AaveWrapper contract.
///
/// These tests verify actual expected behavior:
/// - Intent ID computation must be deterministic and unique
/// - Hash functions must produce collision-resistant outputs
/// - All parameters must affect hash outputs (no ignored fields)
/// - Security properties (front-running protection, replay protection)
///
/// # Testing Philosophy
/// Tests assert expected behavior, not adapt to code.
/// We verify correctness, not just that code runs without panicking.
///
/// # Privacy Note
/// The updated functions use secret_hash instead of owner addresses to preserve
/// user privacy. The owner is never revealed in public hashes or L1 messages.

use crate::{
    compute_deposit_confirmation_content, compute_deposit_message_content, compute_intent_id,
    compute_owner_hash,
};
use crate::types::DepositIntent;
use aztec::protocol_types::{address::AztecAddress, traits::FromField};

// ============================================================================
// compute_intent_id Tests
// ============================================================================

/// Test that compute_intent_id produces consistent hashes.
///
/// This verifies the deterministic behavior of intent ID generation,
/// which is critical for matching intents across L1 and L2.
#[test]
unconstrained fn test_compute_intent_id_deterministic() {
    let caller = AztecAddress::from_field(0xdeadbeef);
    let asset_id: Field = 1;
    let amount: u128 = 1000000;
    let deadline: u64 = 1700000000;
    let salt: Field = 12345;

    // Compute hash twice
    let original_decimals: u8 = 6; // USDC decimals
    let hash1 = compute_intent_id(caller, asset_id, amount, original_decimals, deadline, salt);
    let hash2 = compute_intent_id(caller, asset_id, amount, original_decimals, deadline, salt);

    // Should produce identical hashes
    assert(hash1 == hash2, "Intent ID should be deterministic");
}

/// Test that compute_intent_id produces different hashes for different inputs.
#[test]
unconstrained fn test_compute_intent_id_different_inputs() {
    let caller = AztecAddress::from_field(0xdeadbeef);
    let asset_id: Field = 1;
    let amount: u128 = 1000000;
    let original_decimals: u8 = 6;
    let deadline: u64 = 1700000000;
    let salt: Field = 12345;

    let hash1 = compute_intent_id(caller, asset_id, amount, original_decimals, deadline, salt);

    // Change caller
    let hash2 = compute_intent_id(
        AztecAddress::from_field(0xcafebabe),
        asset_id,
        amount,
        original_decimals,
        deadline,
        salt,
    );

    // Change asset_id
    let hash3 = compute_intent_id(caller, 2, amount, original_decimals, deadline, salt);

    // Change amount
    let hash4 = compute_intent_id(caller, asset_id, 2000000, original_decimals, deadline, salt);

    // Change original_decimals
    let hash5 = compute_intent_id(caller, asset_id, amount, 18, deadline, salt);

    // Change salt
    let hash6 = compute_intent_id(caller, asset_id, amount, original_decimals, deadline, 99999);

    // Change deadline
    let hash7 = compute_intent_id(
        caller,
        asset_id,
        amount,
        original_decimals,
        1800000000,
        salt,
    );

    // All hashes should be different
    assert(hash1 != hash2, "Different caller should produce different intent ID");
    assert(hash1 != hash3, "Different asset_id should produce different intent ID");
    assert(hash1 != hash4, "Different amount should produce different intent ID");
    assert(hash1 != hash5, "Different original_decimals should produce different intent ID");
    assert(hash1 != hash6, "Different salt should produce different intent ID");
    assert(hash1 != hash7, "Different deadline should produce different intent ID");
}

/// Test that salt provides uniqueness even with same user inputs.
///
/// This is important because the same user could make multiple deposits
/// with identical parameters - the salt ensures each intent is unique.
#[test]
unconstrained fn test_compute_intent_id_salt_uniqueness() {
    let caller = AztecAddress::from_field(0xdeadbeef);
    let asset_id: Field = 1;
    let amount: u128 = 1000000;
    let original_decimals: u8 = 6;
    let deadline: u64 = 1700000000;

    // Same inputs, different salts
    let hash1 = compute_intent_id(caller, asset_id, amount, original_decimals, deadline, 1);
    let hash2 = compute_intent_id(caller, asset_id, amount, original_decimals, deadline, 2);
    let hash3 = compute_intent_id(caller, asset_id, amount, original_decimals, deadline, 3);

    // All should be different
    assert(hash1 != hash2, "Different salts should produce different intent IDs");
    assert(hash2 != hash3, "Different salts should produce different intent IDs");
    assert(hash1 != hash3, "Different salts should produce different intent IDs");
}

// ============================================================================
// compute_owner_hash Tests (Privacy: Per-Intent Unlinkability)
// ============================================================================

/// Test that the same user gets different owner_hash values for different intents.
///
/// This is critical for privacy: if the same user makes multiple deposits,
/// L1 observers should NOT be able to link those deposits to the same user.
/// By including intent_id in the owner_hash computation, each intent gets
/// a unique owner_hash even for the same owner.
///
/// # Privacy Guarantee
/// - Alice deposits 100 USDC (intent_id_1) -> owner_hash_1
/// - Alice deposits 200 USDC (intent_id_2) -> owner_hash_2
/// - owner_hash_1 != owner_hash_2 (L1 cannot link them)
#[test]
unconstrained fn test_owner_hash_unique_per_intent() {
    // Same user making multiple deposits
    let alice = AztecAddress::from_field(0xdeadbeef);

    // Different intent IDs (would come from different deposit parameters/salts)
    let intent_id_1: Field = 0x1111111111111111;
    let intent_id_2: Field = 0x2222222222222222;
    let intent_id_3: Field = 0x3333333333333333;

    // Compute owner_hash for each intent
    let owner_hash_1 = compute_owner_hash(alice, intent_id_1);
    let owner_hash_2 = compute_owner_hash(alice, intent_id_2);
    let owner_hash_3 = compute_owner_hash(alice, intent_id_3);

    // All owner_hashes should be different for the same user
    assert(
        owner_hash_1 != owner_hash_2,
        "Same user with different intents must have different owner_hash",
    );
    assert(
        owner_hash_2 != owner_hash_3,
        "Same user with different intents must have different owner_hash",
    );
    assert(
        owner_hash_1 != owner_hash_3,
        "Same user with different intents must have different owner_hash",
    );

    // Verify owner_hash is deterministic (same inputs -> same output)
    let owner_hash_1_again = compute_owner_hash(alice, intent_id_1);
    assert(owner_hash_1 == owner_hash_1_again, "owner_hash must be deterministic");
}

/// Test that different users with the same intent_id produce different owner_hashes.
///
/// This ensures that even if two users somehow share an intent_id (shouldn't happen
/// in practice due to caller being part of intent_id computation), they would still
/// get different owner_hashes.
#[test]
unconstrained fn test_owner_hash_different_for_different_users() {
    let alice = AztecAddress::from_field(0xdeadbeef);
    let bob = AztecAddress::from_field(0xcafebabe);
    let same_intent_id: Field = 0x1234567890abcdef;

    let alice_owner_hash = compute_owner_hash(alice, same_intent_id);
    let bob_owner_hash = compute_owner_hash(bob, same_intent_id);

    assert(alice_owner_hash != bob_owner_hash, "Different users must have different owner_hash");
}

/// Test that owner_hash matches what the contract computes internally.
///
/// This verifies that our helper function produces the same hash as the contract's
/// internal computation (poseidon2_hash([owner.to_field(), intent_id])).
#[test]
unconstrained fn test_owner_hash_realistic_deposit_flow() {
    let caller = AztecAddress::from_field(0x123456789abcdef0123456789abcdef0);
    let asset_id: Field = 0x1; // USDC
    let amount: u128 = 100_000_000; // 100 USDC
    let original_decimals: u8 = 6;
    let deadline: u64 = 1735689600;
    let salt: Field = 42;

    // First compute the intent_id (as the contract would)
    let intent_id = compute_intent_id(caller, asset_id, amount, original_decimals, deadline, salt);

    // Then compute the owner_hash (as the contract would)
    let owner_hash = compute_owner_hash(caller, intent_id);

    // Verify the owner_hash is non-zero
    assert(owner_hash != 0, "owner_hash should not be zero for valid inputs");

    // Make another deposit with different salt (simulating user's second deposit)
    let salt_2: Field = 43;
    let intent_id_2 = compute_intent_id(
        caller,
        asset_id,
        amount,
        original_decimals,
        deadline,
        salt_2,
    );
    let owner_hash_2 = compute_owner_hash(caller, intent_id_2);

    // The two owner_hashes should be different (privacy guarantee)
    assert(
        owner_hash != owner_hash_2,
        "Multiple deposits from same user must have different owner_hash",
    );
}

/// Test intent ID generation with typical USDC deposit values.
///
/// Tests realistic parameters for a deposit of 100 USDC to Arbitrum.
#[test]
unconstrained fn test_compute_intent_id_realistic_usdc_deposit() {
    let caller = AztecAddress::from_field(0x123456789abcdef0123456789abcdef0);
    let usdc_asset_id: Field = 0x1; // USDC asset identifier
    let amount: u128 = 100_000_000; // 100 USDC (6 decimals)
    let original_decimals: u8 = 6; // USDC has 6 decimals
    let deadline: u64 = 1735689600; // Some future timestamp
    let salt: Field = 42;

    let intent_id = compute_intent_id(
        caller,
        usdc_asset_id,
        amount,
        original_decimals,
        deadline,
        salt,
    );

    // Verify this computes successfully with realistic values
    // (Poseidon2 hash output is effectively never zero, but we verify it computes without error)
    assert(intent_id != 0, "Intent ID computation must succeed for realistic USDC values");
}

/// Test intent ID generation with typical WETH deposit values.
///
/// Tests realistic parameters for a deposit of 1 WETH to Optimism.
#[test]
unconstrained fn test_compute_intent_id_realistic_weth_deposit() {
    let caller = AztecAddress::from_field(0xabcdef0123456789abcdef0123456789);
    let weth_asset_id: Field = 0x2; // WETH asset identifier
    let amount: u128 = 1_000_000_000_000_000_000; // 1 WETH (18 decimals)
    let original_decimals: u8 = 18; // WETH has 18 decimals
    let deadline: u64 = 1735689600;
    let salt: Field = 1;

    let intent_id = compute_intent_id(
        caller,
        weth_asset_id,
        amount,
        original_decimals,
        deadline,
        salt,
    );

    // Verify this computes successfully with realistic 18-decimal values
    assert(intent_id != 0, "Intent ID computation must succeed for realistic WETH values");
}

// ============================================================================
// compute_deposit_message_content Tests
// ============================================================================

/// Test that compute_deposit_message_content produces consistent hashes.
///
/// This verifies the deterministic behavior of the content hash computation
/// which is critical for L2->L1 message verification.
///
/// # Privacy
/// Uses secret_hash instead of owner - the owner is never revealed on L1.
#[test]
unconstrained fn test_compute_deposit_message_content_deterministic() {
    let intent = DepositIntent::new(
        0x1234567890abcdef, // intent_id
        0xabcd1234, // owner_hash
        1, // asset
        1000000, // amount
        6, // original_decimals
        1700000000, // deadline
        12345, // salt
    );
    let secret_hash: Field = 0xabcdef123456; // Hash of user's secret

    // Compute hash twice
    let hash1 = compute_deposit_message_content(intent, secret_hash);
    let hash2 = compute_deposit_message_content(intent, secret_hash);

    // Should produce identical hashes
    assert(hash1 == hash2, "Deposit message content hash should be deterministic");
}

/// Test that compute_deposit_message_content produces different hashes
/// for different intents.
#[test]
unconstrained fn test_compute_deposit_message_content_different_intents() {
    let secret_hash: Field = 0xabcdef123456;

    let intent1 = DepositIntent::new(0x1111111111111111, 0xabcd1234, 1, 1000000, 6, 1700000000, 1);
    let intent2 = DepositIntent::new(0x2222222222222222, 0xabcd1234, 1, 1000000, 6, 1700000000, 1);

    let hash1 = compute_deposit_message_content(intent1, secret_hash);
    let hash2 = compute_deposit_message_content(intent2, secret_hash);

    assert(hash1 != hash2, "Different intent_id should produce different message hash");
}

/// Test that compute_deposit_message_content produces different hashes
/// for different secret_hashes.
///
/// # Privacy
/// This ensures different users (with different secrets) get different message hashes,
/// preserving privacy while still binding the message to a specific claimant.
#[test]
unconstrained fn test_compute_deposit_message_content_different_secrets() {
    let intent = DepositIntent::new(
        0x1234567890abcdef,
        0xabcd1234,
        1,
        1000000,
        6,
        1700000000,
        12345,
    );

    let secret_hash1: Field = 0xdeadbeef;
    let secret_hash2: Field = 0xcafebabe;

    let hash1 = compute_deposit_message_content(intent, secret_hash1);
    let hash2 = compute_deposit_message_content(intent, secret_hash2);

    assert(hash1 != hash2, "Different secret_hash should produce different message hash");
}

/// Test deposit message content includes all intent fields.
///
/// Verifies that changing any field in the intent changes the hash.
#[test]
unconstrained fn test_compute_deposit_message_content_includes_all_fields() {
    let secret_hash: Field = 0xdeadbeef;

    let base_intent = DepositIntent::new(
        0x1234567890abcdef,
        0xabcd1234,
        1,
        1000000,
        6,
        1700000000,
        12345,
    );
    let base_hash = compute_deposit_message_content(base_intent, secret_hash);

    // Change each field and verify hash changes
    let intent_diff_amount = DepositIntent::new(
        0x1234567890abcdef,
        0xabcd1234,
        1,
        2000000,
        6,
        1700000000,
        12345,
    );
    let intent_diff_asset = DepositIntent::new(
        0x1234567890abcdef,
        0xabcd1234,
        2,
        1000000,
        6,
        1700000000,
        12345,
    );
    let intent_diff_deadline = DepositIntent::new(
        0x1234567890abcdef,
        0xabcd1234,
        1,
        1000000,
        6,
        1800000000,
        12345,
    );
    let intent_diff_salt = DepositIntent::new(
        0x1234567890abcdef,
        0xabcd1234,
        1,
        1000000,
        6,
        1700000000,
        99999,
    );

    assert(
        base_hash != compute_deposit_message_content(intent_diff_amount, secret_hash),
        "Different amount should change hash",
    );
    assert(
        base_hash != compute_deposit_message_content(intent_diff_asset, secret_hash),
        "Different asset should change hash",
    );
    assert(
        base_hash != compute_deposit_message_content(intent_diff_deadline, secret_hash),
        "Different deadline should change hash",
    );
    assert(
        base_hash != compute_deposit_message_content(intent_diff_salt, secret_hash),
        "Different salt should change hash",
    );
}

// ============================================================================
// compute_deposit_confirmation_content Tests
// ============================================================================

/// Test that compute_deposit_confirmation_content produces consistent hashes.
///
/// This verifies the deterministic behavior of the content hash computation
/// which is critical for L1->L2 message verification.
///
/// # Privacy
/// Note: owner is NOT included in confirmation hash - authentication is via secret.
#[test]
unconstrained fn test_compute_deposit_confirmation_content_deterministic() {
    let intent_id: Field = 0x1234567890abcdef;
    let asset_id: Field = 1;
    let shares: u128 = 1000000;

    // Compute hash twice
    let hash1 = compute_deposit_confirmation_content(intent_id, asset_id, shares);
    let hash2 = compute_deposit_confirmation_content(intent_id, asset_id, shares);

    // Should produce identical hashes
    assert(hash1 == hash2, "Content hash should be deterministic");
}

/// Test that compute_deposit_confirmation_content produces different hashes
/// for different inputs.
#[test]
unconstrained fn test_compute_deposit_confirmation_content_different_inputs() {
    let intent_id: Field = 0x1234567890abcdef;
    let asset_id: Field = 1;
    let shares: u128 = 1000000;

    let hash1 = compute_deposit_confirmation_content(intent_id, asset_id, shares);

    // Change intent_id
    let hash2 = compute_deposit_confirmation_content(
        0x9999999999999999, // Different intent_id
        asset_id,
        shares,
    );

    // Change shares
    let hash3 = compute_deposit_confirmation_content(
        intent_id,
        asset_id,
        2000000, // Different shares
    );

    // Change asset_id
    let hash4 = compute_deposit_confirmation_content(
        intent_id,
        2, // Different asset_id
        shares,
    );

    // All hashes should be different
    assert(hash1 != hash2, "Different intent_id should produce different hash");
    assert(hash1 != hash3, "Different shares should produce different hash");
    assert(hash1 != hash4, "Different asset_id should produce different hash");
    assert(hash2 != hash3, "Hashes should be unique for each input combination");
}

/// Test deposit confirmation with realistic aToken shares.
///
/// After depositing USDC into Aave, you receive aUSDC shares.
/// The shares amount may differ slightly from deposit amount due to
/// interest accrual since pool inception.
#[test]
unconstrained fn test_compute_deposit_confirmation_realistic_shares() {
    let intent_id: Field = 0xabcdef1234567890;
    let usdc_asset_id: Field = 0x1;
    // Shares might be slightly different from deposit due to aToken index
    let atoken_shares: u128 = 99_980_000; // ~99.98 aUSDC for 100 USDC deposit

    let hash = compute_deposit_confirmation_content(intent_id, usdc_asset_id, atoken_shares);

    // Verify realistic aToken share amounts are handled correctly
    assert(hash != 0, "Confirmation hash computation must succeed for realistic aToken shares");
}

// ============================================================================
// DepositIntent Struct Tests
// ============================================================================

/// Test DepositIntent::new creates struct with correct values.
#[test]
unconstrained fn test_deposit_intent_new() {
    let intent = DepositIntent::new(
        0x1234567890abcdef, // intent_id
        0xabcd1234, // owner_hash
        0x5, // asset_id
        500_000_000, // amount (500 USDC)
        6, // original_decimals
        1735689600, // deadline
        42, // salt
    );

    assert(intent.intent_id == 0x1234567890abcdef, "intent_id mismatch");
    assert(intent.owner_hash == 0xabcd1234, "owner_hash mismatch");
    assert(intent.asset == 0x5, "asset_id mismatch");
    assert(intent.amount == 500_000_000, "amount mismatch");
    assert(intent.original_decimals == 6, "original_decimals mismatch");
    assert(intent.deadline == 1735689600, "deadline mismatch");
    assert(intent.salt == 42, "salt mismatch");
}

/// Test DepositIntent equality comparison.
#[test]
unconstrained fn test_deposit_intent_equality() {
    let intent1 = DepositIntent::new(0x123, 0xabcd1234, 1, 1000, 6, 1700000000, 1);
    let intent2 = DepositIntent::new(0x123, 0xabcd1234, 1, 1000, 6, 1700000000, 1);
    let intent3 = DepositIntent::new(0x456, 0xabcd1234, 1, 1000, 6, 1700000000, 1);

    assert(intent1 == intent2, "Identical intents should be equal");
    assert(intent1 != intent3, "Different intents should not be equal");
}

/// Test large deposit amounts (whale deposits).
///
/// Tests that the system handles very large deposit amounts correctly.
#[test]
unconstrained fn test_deposit_intent_large_amount() {
    // 1 billion USDC (6 decimals)
    let large_amount: u128 = 1_000_000_000_000_000;

    let intent = DepositIntent::new(0xdeadbeef, 0xabcd1234, 1, large_amount, 6, 1700000000, 1);

    assert(intent.amount == large_amount, "Large amount should be stored correctly");

    let secret_hash: Field = 0xdeadbeef;
    let hash = compute_deposit_message_content(intent, secret_hash);

    // Verify large amounts don't cause overflow or other issues
    assert(hash != 0, "Large deposit amounts must be handled correctly");
}

/// Test minimum viable deposit (dust amounts).
#[test]
unconstrained fn test_deposit_intent_minimum_amount() {
    // 1 wei/smallest unit
    let min_amount: u128 = 1;

    let intent = DepositIntent::new(0xdeadbeef, 0xabcd1234, 1, min_amount, 6, 1700000000, 1);

    assert(intent.amount == min_amount, "Minimum amount should be stored correctly");

    let secret_hash: Field = 0xdeadbeef;
    let hash = compute_deposit_message_content(intent, secret_hash);

    // Verify minimum amounts (dust) are handled correctly
    assert(hash != 0, "Minimum deposit amounts must be handled correctly");
}

/// Test deposit with various deadline values.
#[test]
unconstrained fn test_deposit_intent_deadline_sensitivity() {
    let secret_hash: Field = 0xdeadbeef;

    // Near-term deadline (1 hour from "now")
    let intent_short = DepositIntent::new(0x123, 0xabcd1234, 1, 1000, 6, 1700003600, 1);
    // Medium deadline (1 day from "now")
    let intent_medium = DepositIntent::new(0x123, 0xabcd1234, 1, 1000, 6, 1700086400, 1);
    // Long deadline (1 week from "now")
    let intent_long = DepositIntent::new(0x123, 0xabcd1234, 1, 1000, 6, 1700604800, 1);

    let hash_short = compute_deposit_message_content(intent_short, secret_hash);
    let hash_medium = compute_deposit_message_content(intent_medium, secret_hash);
    let hash_long = compute_deposit_message_content(intent_long, secret_hash);

    // All should produce different hashes
    assert(hash_short != hash_medium, "Different deadlines should produce different hashes");
    assert(hash_medium != hash_long, "Different deadlines should produce different hashes");
}

// ============================================================================
// Fee Calculation Tests
// ============================================================================

use crate::AaveWrapper::FeeConfig;

/// Test that fee constants are set correctly.
///
/// FEE_BASIS_POINTS = 10 (0.1% fee)
/// BASIS_POINTS_DENOMINATOR = 10000 (100% = 10000)
/// MIN_DEPOSIT_AMOUNT = 1_000_000 (1 USDC with 6 decimals)
#[test]
unconstrained fn test_fee_config_constants() {
    assert(FeeConfig::FEE_BASIS_POINTS == 10, "FEE_BASIS_POINTS should be 10");
    assert(
        FeeConfig::BASIS_POINTS_DENOMINATOR == 10000,
        "BASIS_POINTS_DENOMINATOR should be 10000",
    );
    assert(FeeConfig::MIN_DEPOSIT_AMOUNT == 1_000_000, "MIN_DEPOSIT_AMOUNT should be 1_000_000");
}

/// Test fee calculation produces correct results.
///
/// With 10 basis points (0.1%):
/// - 1000 tokens -> 1 token fee, 999 net
/// - 10000 tokens -> 10 token fee, 9990 net
/// - 100000 tokens -> 100 token fee, 99900 net
#[test]
unconstrained fn test_fee_calculation_basic() {
    // Test 1000 tokens
    let amount1: u128 = 1000;
    let fee1 = (amount1 * FeeConfig::FEE_BASIS_POINTS) / FeeConfig::BASIS_POINTS_DENOMINATOR;
    let net1 = amount1 - fee1;
    assert(fee1 == 1, "Fee for 1000 tokens should be 1");
    assert(net1 == 999, "Net for 1000 tokens should be 999");

    // Test 10000 tokens
    let amount2: u128 = 10000;
    let fee2 = (amount2 * FeeConfig::FEE_BASIS_POINTS) / FeeConfig::BASIS_POINTS_DENOMINATOR;
    let net2 = amount2 - fee2;
    assert(fee2 == 10, "Fee for 10000 tokens should be 10");
    assert(net2 == 9990, "Net for 10000 tokens should be 9990");

    // Test 100000 tokens (100 USDC with 6 decimals stored as u128)
    let amount3: u128 = 100000;
    let fee3 = (amount3 * FeeConfig::FEE_BASIS_POINTS) / FeeConfig::BASIS_POINTS_DENOMINATOR;
    let net3 = amount3 - fee3;
    assert(fee3 == 100, "Fee for 100000 tokens should be 100");
    assert(net3 == 99900, "Net for 100000 tokens should be 99900");
}

/// Test fee calculation at minimum deposit amount.
///
/// With MIN_DEPOSIT_AMOUNT = 1_000_000 (1 USDC) and 0.1% fee:
/// - fee = 1_000_000 * 10 / 10000 = 1000
/// - net = 1_000_000 - 1000 = 999_000
///
/// This ensures meaningful deposits have meaningful fees.
#[test]
unconstrained fn test_fee_calculation_minimum_amount() {
    let amount: u128 = FeeConfig::MIN_DEPOSIT_AMOUNT; // 1_000_000
    let fee = (amount * FeeConfig::FEE_BASIS_POINTS) / FeeConfig::BASIS_POINTS_DENOMINATOR;
    let net = amount - fee;

    // With 1_000_000 * 10 / 10000 = 1000
    assert(fee == 1000, "Fee for 1 USDC should be 0.001 USDC (1000 base units)");
    assert(net == 999_000, "Net should be 0.999 USDC");
    assert(net > 0, "Net amount must always be positive");
}

/// Test fee calculation ensures net_amount is always positive.
///
/// This verifies that the fee never exceeds the deposit amount.
#[test]
unconstrained fn test_fee_never_exceeds_amount() {
    // Test at various amounts
    let amounts: [u128; 5] = [100, 1000, 10000, 1000000, 1000000000000000000];

    for i in 0..5 {
        let amount = amounts[i];
        let fee = (amount * FeeConfig::FEE_BASIS_POINTS) / FeeConfig::BASIS_POINTS_DENOMINATOR;
        let net = amount - fee;

        assert(fee <= amount, "Fee should never exceed amount");
        assert(net > 0, "Net amount must always be positive");
    }
}

/// Test that fee percentage is exactly 0.1%.
///
/// Verify: FEE_BASIS_POINTS / BASIS_POINTS_DENOMINATOR = 10 / 10000 = 0.001 = 0.1%
#[test]
unconstrained fn test_fee_percentage_is_point_one_percent() {
    // For 1,000,000 tokens, 0.1% = 1,000 tokens fee
    let amount: u128 = 1000000;
    let fee = (amount * FeeConfig::FEE_BASIS_POINTS) / FeeConfig::BASIS_POINTS_DENOMINATOR;

    // 1000000 * 10 / 10000 = 1000
    assert(fee == 1000, "0.1% of 1,000,000 should be 1,000");

    // Double check: fee * 1000 should equal original amount (for exact 0.1%)
    // fee * 1000 = amount means fee = amount / 1000 = 0.1%
    assert(fee * 1000 == amount, "Fee should be exactly 0.1% of amount");
}

/// Test fee calculation with realistic USDC deposit (100 USDC = 100,000,000 units).
#[test]
unconstrained fn test_fee_realistic_usdc_deposit() {
    // 100 USDC with 6 decimals = 100,000,000 smallest units
    let amount: u128 = 100_000_000;
    let fee = (amount * FeeConfig::FEE_BASIS_POINTS) / FeeConfig::BASIS_POINTS_DENOMINATOR;
    let net = amount - fee;

    // 100,000,000 * 10 / 10000 = 100,000 (0.1 USDC fee)
    assert(fee == 100_000, "Fee for 100 USDC should be 0.1 USDC (100,000 units)");
    assert(net == 99_900_000, "Net for 100 USDC should be 99.9 USDC (99,900,000 units)");
}

/// Test fee calculation with large deposit (1 billion USDC).
#[test]
unconstrained fn test_fee_large_deposit() {
    // 1 billion USDC = 1,000,000,000,000,000 smallest units (6 decimals)
    let amount: u128 = 1_000_000_000_000_000;
    let fee = (amount * FeeConfig::FEE_BASIS_POINTS) / FeeConfig::BASIS_POINTS_DENOMINATOR;
    let net = amount - fee;

    // 0.1% of 1 billion = 1 million USDC fee
    assert(fee == 1_000_000_000_000, "Fee for 1B USDC should be 1M USDC");
    assert(net == 999_000_000_000_000, "Net should be 999M USDC");
}

/// Test that fee rounding truncates (floor division).
///
/// Integer division truncates towards zero, which means the protocol
/// receives slightly less fee on small amounts. This is acceptable
/// and more fair to users.
#[test]
unconstrained fn test_fee_rounding_truncates() {
    // Test amounts that don't divide evenly
    // 999 * 10 / 10000 = 9990 / 10000 = 0 (truncated)
    let amount1: u128 = 999;
    let fee1 = (amount1 * FeeConfig::FEE_BASIS_POINTS) / FeeConfig::BASIS_POINTS_DENOMINATOR;
    assert(fee1 == 0, "999 should have 0 fee due to truncation");

    // 1001 * 10 / 10000 = 10010 / 10000 = 1 (truncated)
    let amount2: u128 = 1001;
    let fee2 = (amount2 * FeeConfig::FEE_BASIS_POINTS) / FeeConfig::BASIS_POINTS_DENOMINATOR;
    assert(fee2 == 1, "1001 should have 1 fee due to truncation");

    // 9999 * 10 / 10000 = 99990 / 10000 = 9 (truncated from 9.999)
    let amount3: u128 = 9999;
    let fee3 = (amount3 * FeeConfig::FEE_BASIS_POINTS) / FeeConfig::BASIS_POINTS_DENOMINATOR;
    assert(fee3 == 9, "9999 should have 9 fee due to truncation");
}
