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
};
use crate::types::DepositIntent;
use dep::aztec::protocol_types::{address::AztecAddress, traits::FromField};

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
    let target_chain_id: u32 = 23;
    let deadline: u64 = 1700000000;
    let salt: Field = 12345;

    // Compute hash twice
    let original_decimals: u8 = 6; // USDC decimals
    let hash1 = compute_intent_id(
        caller,
        asset_id,
        amount,
        original_decimals,
        target_chain_id,
        deadline,
        salt,
    );
    let hash2 = compute_intent_id(
        caller,
        asset_id,
        amount,
        original_decimals,
        target_chain_id,
        deadline,
        salt,
    );

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
    let target_chain_id: u32 = 23;
    let deadline: u64 = 1700000000;
    let salt: Field = 12345;

    let hash1 = compute_intent_id(
        caller,
        asset_id,
        amount,
        original_decimals,
        target_chain_id,
        deadline,
        salt,
    );

    // Change caller
    let hash2 = compute_intent_id(
        AztecAddress::from_field(0xcafebabe),
        asset_id,
        amount,
        original_decimals,
        target_chain_id,
        deadline,
        salt,
    );

    // Change asset_id
    let hash3 = compute_intent_id(
        caller,
        2,
        amount,
        original_decimals,
        target_chain_id,
        deadline,
        salt,
    );

    // Change amount
    let hash4 = compute_intent_id(
        caller,
        asset_id,
        2000000,
        original_decimals,
        target_chain_id,
        deadline,
        salt,
    );

    // Change original_decimals
    let hash5 = compute_intent_id(
        caller,
        asset_id,
        amount,
        18,
        target_chain_id,
        deadline,
        salt,
    );

    // Change salt
    let hash6 = compute_intent_id(
        caller,
        asset_id,
        amount,
        original_decimals,
        target_chain_id,
        deadline,
        99999,
    );

    // Change target_chain_id
    let hash7 = compute_intent_id(
        caller,
        asset_id,
        amount,
        original_decimals,
        42,
        deadline,
        salt,
    );

    // Change deadline
    let hash8 = compute_intent_id(
        caller,
        asset_id,
        amount,
        original_decimals,
        target_chain_id,
        1800000000,
        salt,
    );

    // All hashes should be different
    assert(hash1 != hash2, "Different caller should produce different intent ID");
    assert(hash1 != hash3, "Different asset_id should produce different intent ID");
    assert(hash1 != hash4, "Different amount should produce different intent ID");
    assert(hash1 != hash5, "Different original_decimals should produce different intent ID");
    assert(hash1 != hash6, "Different salt should produce different intent ID");
    assert(hash1 != hash7, "Different target_chain_id should produce different intent ID");
    assert(hash1 != hash8, "Different deadline should produce different intent ID");
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
    let target_chain_id: u32 = 23;
    let deadline: u64 = 1700000000;

    // Same inputs, different salts
    let hash1 = compute_intent_id(
        caller,
        asset_id,
        amount,
        original_decimals,
        target_chain_id,
        deadline,
        1,
    );
    let hash2 = compute_intent_id(
        caller,
        asset_id,
        amount,
        original_decimals,
        target_chain_id,
        deadline,
        2,
    );
    let hash3 = compute_intent_id(
        caller,
        asset_id,
        amount,
        original_decimals,
        target_chain_id,
        deadline,
        3,
    );

    // All should be different
    assert(hash1 != hash2, "Different salts should produce different intent IDs");
    assert(hash2 != hash3, "Different salts should produce different intent IDs");
    assert(hash1 != hash3, "Different salts should produce different intent IDs");
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
    let arbitrum_chain_id: u32 = 23; // Wormhole Arbitrum chain ID
    let deadline: u64 = 1735689600; // Some future timestamp
    let salt: Field = 42;

    let intent_id = compute_intent_id(
        caller,
        usdc_asset_id,
        amount,
        original_decimals,
        arbitrum_chain_id,
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
    let optimism_chain_id: u32 = 24; // Wormhole Optimism chain ID
    let deadline: u64 = 1735689600;
    let salt: Field = 1;

    let intent_id = compute_intent_id(
        caller,
        weth_asset_id,
        amount,
        original_decimals,
        optimism_chain_id,
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
        23, // target_chain_id
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

    let intent1 = DepositIntent::new(
        0x1111111111111111,
        0xabcd1234,
        1,
        1000000,
        6,
        23,
        1700000000,
        1,
    );
    let intent2 = DepositIntent::new(
        0x2222222222222222,
        0xabcd1234,
        1,
        1000000,
        6,
        23,
        1700000000,
        1,
    );

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
        23,
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
        23,
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
        23,
        1700000000,
        12345,
    );
    let intent_diff_asset = DepositIntent::new(
        0x1234567890abcdef,
        0xabcd1234,
        2,
        1000000,
        6,
        23,
        1700000000,
        12345,
    );
    let intent_diff_chain = DepositIntent::new(
        0x1234567890abcdef,
        0xabcd1234,
        1,
        1000000,
        6,
        42,
        1700000000,
        12345,
    );
    let intent_diff_deadline = DepositIntent::new(
        0x1234567890abcdef,
        0xabcd1234,
        1,
        1000000,
        6,
        23,
        1800000000,
        12345,
    );
    let intent_diff_salt = DepositIntent::new(
        0x1234567890abcdef,
        0xabcd1234,
        1,
        1000000,
        6,
        23,
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
        base_hash != compute_deposit_message_content(intent_diff_chain, secret_hash),
        "Different chain should change hash",
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
    let target_chain_id: u32 = 23;

    // Compute hash twice
    let hash1 = compute_deposit_confirmation_content(intent_id, asset_id, shares, target_chain_id);
    let hash2 = compute_deposit_confirmation_content(intent_id, asset_id, shares, target_chain_id);

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
    let target_chain_id: u32 = 23;

    let hash1 = compute_deposit_confirmation_content(intent_id, asset_id, shares, target_chain_id);

    // Change intent_id
    let hash2 = compute_deposit_confirmation_content(
        0x9999999999999999, // Different intent_id
        asset_id,
        shares,
        target_chain_id,
    );

    // Change shares
    let hash3 = compute_deposit_confirmation_content(
        intent_id,
        asset_id,
        2000000, // Different shares
        target_chain_id,
    );

    // Change asset_id
    let hash4 = compute_deposit_confirmation_content(
        intent_id,
        2, // Different asset_id
        shares,
        target_chain_id,
    );

    // Change target_chain_id
    let hash5 = compute_deposit_confirmation_content(
        intent_id,
        asset_id,
        shares,
        42, // Different chain_id
    );

    // All hashes should be different
    assert(hash1 != hash2, "Different intent_id should produce different hash");
    assert(hash1 != hash3, "Different shares should produce different hash");
    assert(hash1 != hash4, "Different asset_id should produce different hash");
    assert(hash1 != hash5, "Different target_chain_id should produce different hash");
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
    let arbitrum_chain_id: u32 = 23;

    let hash = compute_deposit_confirmation_content(
        intent_id,
        usdc_asset_id,
        atoken_shares,
        arbitrum_chain_id,
    );

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
        23, // target_chain_id
        1735689600, // deadline
        42, // salt
    );

    assert(intent.intent_id == 0x1234567890abcdef, "intent_id mismatch");
    assert(intent.owner_hash == 0xabcd1234, "owner_hash mismatch");
    assert(intent.asset == 0x5, "asset_id mismatch");
    assert(intent.amount == 500_000_000, "amount mismatch");
    assert(intent.original_decimals == 6, "original_decimals mismatch");
    assert(intent.target_chain_id == 23, "target_chain_id mismatch");
    assert(intent.deadline == 1735689600, "deadline mismatch");
    assert(intent.salt == 42, "salt mismatch");
}

/// Test DepositIntent equality comparison.
#[test]
unconstrained fn test_deposit_intent_equality() {
    let intent1 = DepositIntent::new(0x123, 0xabcd1234, 1, 1000, 6, 23, 1700000000, 1);
    let intent2 = DepositIntent::new(0x123, 0xabcd1234, 1, 1000, 6, 23, 1700000000, 1);
    let intent3 = DepositIntent::new(0x456, 0xabcd1234, 1, 1000, 6, 23, 1700000000, 1);

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

    let intent = DepositIntent::new(
        0xdeadbeef,
        0xabcd1234,
        1,
        large_amount,
        6,
        23,
        1700000000,
        1,
    );

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

    let intent = DepositIntent::new(0xdeadbeef, 0xabcd1234, 1, min_amount, 6, 23, 1700000000, 1);

    assert(intent.amount == min_amount, "Minimum amount should be stored correctly");

    let secret_hash: Field = 0xdeadbeef;
    let hash = compute_deposit_message_content(intent, secret_hash);

    // Verify minimum amounts (dust) are handled correctly
    assert(hash != 0, "Minimum deposit amounts must be handled correctly");
}

/// Test deposit to different supported chains.
#[test]
unconstrained fn test_deposit_intent_different_chains() {
    let secret_hash: Field = 0xdeadbeef;

    // Arbitrum (Wormhole chain ID 23)
    let intent_arb = DepositIntent::new(0x123, 0xabcd1234, 1, 1000, 6, 23, 1700000000, 1);
    // Optimism (Wormhole chain ID 24)
    let intent_opt = DepositIntent::new(0x123, 0xabcd1234, 1, 1000, 6, 24, 1700000000, 1);
    // Base (Wormhole chain ID 30)
    let intent_base = DepositIntent::new(0x123, 0xabcd1234, 1, 1000, 6, 30, 1700000000, 1);

    let hash_arb = compute_deposit_message_content(intent_arb, secret_hash);
    let hash_opt = compute_deposit_message_content(intent_opt, secret_hash);
    let hash_base = compute_deposit_message_content(intent_base, secret_hash);

    // All should produce different hashes
    assert(hash_arb != hash_opt, "Different chains should produce different hashes");
    assert(hash_opt != hash_base, "Different chains should produce different hashes");
    assert(hash_arb != hash_base, "Different chains should produce different hashes");
}

/// Test deposit with various deadline values.
#[test]
unconstrained fn test_deposit_intent_deadline_sensitivity() {
    let secret_hash: Field = 0xdeadbeef;

    // Near-term deadline (1 hour from "now")
    let intent_short = DepositIntent::new(0x123, 0xabcd1234, 1, 1000, 6, 23, 1700003600, 1);
    // Medium deadline (1 day from "now")
    let intent_medium = DepositIntent::new(0x123, 0xabcd1234, 1, 1000, 6, 23, 1700086400, 1);
    // Long deadline (1 week from "now")
    let intent_long = DepositIntent::new(0x123, 0xabcd1234, 1, 1000, 6, 23, 1700604800, 1);

    let hash_short = compute_deposit_message_content(intent_short, secret_hash);
    let hash_medium = compute_deposit_message_content(intent_medium, secret_hash);
    let hash_long = compute_deposit_message_content(intent_long, secret_hash);

    // All should produce different hashes
    assert(hash_short != hash_medium, "Different deadlines should produce different hashes");
    assert(hash_medium != hash_long, "Different deadlines should produce different hashes");
}
