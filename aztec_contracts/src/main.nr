pub mod types;
mod test;

use dep::aztec::macros::aztec;
use dep::aztec::protocol_types::{address::AztecAddress, hash::poseidon2_hash, traits::ToField};

use crate::types::DepositIntent;

/// Computes a unique intent ID from the deposit parameters.
///
/// Uses poseidon2 hash to create a deterministic identifier that:
/// - Binds the intent to the caller (prevents front-running)
/// - Includes all deposit parameters (enables L1 verification)
/// - Uses nonce-derived salt (prevents replay across sessions)
///
/// # Arguments
/// * `caller` - The address initiating the deposit
/// * `asset_id` - Asset identifier
/// * `amount` - Deposit amount
/// * `target_chain_id` - Target chain for the deposit
/// * `deadline` - Intent expiration timestamp
/// * `salt` - Random value for uniqueness
///
/// # Returns
/// * `Field` - The computed intent ID
pub fn compute_intent_id(
    caller: AztecAddress,
    asset_id: Field,
    amount: u128,
    target_chain_id: u32,
    deadline: u64,
    salt: u32,
) -> Field {
    // Pack inputs into array for hashing
    // Note: We convert smaller types to Field for uniform hashing
    poseidon2_hash([
        caller.to_field(),
        asset_id,
        amount as Field,
        target_chain_id as Field,
        deadline as Field,
        salt as Field,
    ])
}

/// Computes the message content hash for L2 to L1 deposit messages.
///
/// This hash is what the L1 portal contract will verify when consuming
/// the cross-chain message. The encoding must match the Solidity expectation.
///
/// # Privacy
/// The owner_l2 address is intentionally NOT included in this hash.
/// L1 execution is performed by relayers who don't need to know the L2 owner.
/// The secret/secretHash mechanism in the L1->L2 confirmation provides authentication.
///
/// # Arguments
/// * `intent` - The deposit intent containing all parameters
/// * `secret_hash` - Hash of the secret that will be used to claim the L1->L2 confirmation
///
/// # Returns
/// * `Field` - The message content hash
pub fn compute_deposit_message_content(intent: DepositIntent, secret_hash: Field) -> Field {
    // Hash intent fields plus secret_hash for the L2 to L1 message
    // The secret_hash binds the confirmation to whoever knows the secret (the user)
    // L1 portal can verify this without knowing the L2 owner's identity
    poseidon2_hash([
        intent.intent_id,
        intent.asset_id,
        intent.amount as Field,
        intent.target_chain_id as Field,
        intent.deadline as Field,
        intent.salt as Field,
        secret_hash,
    ])
}

/// Computes the message content hash for L1 to L2 deposit confirmation messages.
///
/// This hash is sent by the L1 portal after successfully executing the deposit
/// on the target chain. The L2 contract verifies this when finalizing the deposit.
///
/// # Privacy
/// The owner_l2 address is NOT included - authentication is via the secret mechanism.
/// Only someone who knows the secret (provided during request_deposit) can claim.
///
/// # Arguments
/// * `intent_id` - The unique identifier of the deposit intent
/// * `asset_id` - Identifier for the deposited asset
/// * `shares` - Number of aToken shares received from the Aave deposit
/// * `target_chain_id` - Wormhole chain ID where the deposit was executed
///
/// # Returns
/// * `Field` - The message content hash for L1->L2 verification
pub fn compute_deposit_confirmation_content(
    intent_id: Field,
    asset_id: Field,
    shares: u128,
    target_chain_id: u32,
) -> Field {
    // Hash confirmation data for L1 to L2 message verification
    // This must match the encoding used by the L1 portal when sending the message
    // Owner is authenticated via secret, not included in hash
    poseidon2_hash(
        [intent_id, asset_id, shares as Field, target_chain_id as Field],
    )
}

/// Computes the message content hash for L1 to L2 withdrawal confirmation messages.
///
/// This hash is sent by the L1 portal after successfully executing the withdrawal
/// on the target chain and bridging tokens back. The L2 contract verifies this
/// when finalizing the withdrawal.
///
/// # Privacy
/// The owner_l2 address is NOT included - authentication is via the secret mechanism.
///
/// # Arguments
/// * `intent_id` - The unique identifier of the withdrawal intent
/// * `asset_id` - Identifier for the withdrawn asset
/// * `amount` - Amount of tokens that were withdrawn
/// * `target_chain_id` - Wormhole chain ID where the withdrawal was executed
///
/// # Returns
/// * `Field` - The message content hash for L1->L2 verification
pub fn compute_withdraw_confirmation_content(
    intent_id: Field,
    asset_id: Field,
    amount: u128,
    target_chain_id: u32,
) -> Field {
    // Hash confirmation data for L1 to L2 message verification
    // This must match the encoding used by the L1 portal when sending the message
    // Owner is authenticated via secret, not included in hash
    poseidon2_hash(
        [intent_id, asset_id, amount as Field, target_chain_id as Field],
    )
}

use crate::types::WithdrawIntent;

/// Computes the message content hash for L2 to L1 withdrawal messages.
///
/// This hash is what the L1 portal contract will verify when consuming
/// the cross-chain withdrawal message. The encoding must match the Solidity expectation.
///
/// # Privacy
/// The owner_l2 address is NOT included - L1 relayers don't need to know identity.
/// Authentication is via the secret mechanism in the L1->L2 confirmation.
///
/// # Arguments
/// * `intent` - The withdraw intent containing intent_id, amount, and deadline
/// * `asset_id` - The asset being withdrawn
/// * `target_chain_id` - The target chain where the position exists
/// * `secret_hash` - Hash of the secret for claiming the confirmation
///
/// # Returns
/// * `Field` - The message content hash
pub fn compute_withdraw_message_content(
    intent: WithdrawIntent,
    asset_id: Field,
    target_chain_id: u32,
    secret_hash: Field,
) -> Field {
    // Hash intent fields plus secret_hash for the L2 to L1 message
    // L1 portal can verify this without knowing the L2 owner's identity
    poseidon2_hash([
        intent.intent_id,
        intent.amount as Field,
        intent.deadline as Field,
        asset_id,
        target_chain_id as Field,
        secret_hash,
    ])
}

#[aztec]
pub(crate) contract AaveWrapper {
    use dep::aztec::{
        macros::{events::event, functions::{external, initializer}, storage::storage},
        messages::message_delivery::MessageDelivery,
        note::{note_getter_options::NoteGetterOptions, note_interface::NoteProperties},
        protocol_types::{
            address::{AztecAddress, EthAddress},
            hash::poseidon2_hash,
            traits::ToField,
        },
        state_vars::{Map, Owned, PrivateSet, PublicImmutable, PublicMutable},
        utils::comparison::Comparator,
    };

    use crate::{
        compute_deposit_confirmation_content, compute_deposit_message_content, compute_intent_id,
        compute_withdraw_confirmation_content, compute_withdraw_message_content,
    };
    use crate::types::{DepositIntent, PositionReceiptNote, PositionStatus, WithdrawIntent};

    /// Intent status constants for public state tracking.
    /// These mirror the private PositionStatus but are for public intent lifecycle.
    mod IntentStatus {
        /// Intent has not been submitted or is unknown
        pub global UNKNOWN: u8 = 0;
        /// Intent submitted, awaiting execution on target chain
        pub global PENDING_DEPOSIT: u8 = 1;
        /// Intent successfully executed and confirmed
        pub global CONFIRMED: u8 = 2;
        /// Intent execution failed
        pub global FAILED: u8 = 3;
        /// Withdrawal has been requested, awaiting execution on target chain
        pub global PENDING_WITHDRAW: u8 = 4;
    }

    /// Storage layout for the AaveWrapper contract.
    ///
    /// This struct defines both public and private state variables for managing
    /// cross-chain Aave positions. The storage is organized into:
    /// - Private state: Position receipts (encrypted notes)
    /// - Public state: Intent tracking, admin configuration, and portal address
    ///
    /// Storage slot uniqueness is ensured by the Aztec framework based on field
    /// names and types.
    #[storage]
    struct Storage<Context> {
        /// Private set of position receipt notes.
        /// Each note represents a user's claim on an Aave position.
        /// Uses `Owned` wrapper as per aztec-nr migration (ownership tracked internally).
        receipts: Owned<PrivateSet<PositionReceiptNote, Context>, Context>,

        /// Mapping from intent_id to status code.
        /// Status values:
        /// - 0: Unknown/not submitted
        /// - 1: Pending (submitted, awaiting confirmation)
        /// - 2: Confirmed (successfully executed on target chain)
        /// - 3: Failed (execution failed)
        intent_status: Map<Field, PublicMutable<u8, Context>, Context>,

        /// Mapping from intent_id to consumed flag.
        /// True if the intent has been fully processed and cannot be reused.
        /// Provides replay protection for intents.
        consumed_intents: Map<Field, PublicMutable<bool, Context>, Context>,

        /// Mapping from intent_id to the owner's L2 address.
        /// Used to route finalization messages to the correct user.
        /// This mapping is stored in public state to enable finalization routing,
        /// but the intent_id is a one-way hash so it doesn't reveal user identity
        /// to observers who don't already know the intent parameters.
        intent_owners: Map<Field, PublicMutable<AztecAddress, Context>, Context>,

        /// The admin address with privileged access to contract configuration.
        /// Can update portal address, pause operations, etc.
        admin: PublicMutable<AztecAddress, Context>,

        /// The L1 portal contract address (Ethereum).
        /// This is the entry point for cross-chain messages from Aztec L2 to L1.
        /// Immutable after initialization to prevent redirect attacks.
        portal_address: PublicImmutable<EthAddress, Context>,

        /// Global nonce counter for generating unique intent IDs.
        /// Incremented with each new deposit/withdraw request.
        nonce: PublicMutable<Field, Context>,
    }

    /// Event emitted when a deposit intent status changes.
    ///
    /// # Privacy
    /// This event contains ONLY the intent_id and new status.
    /// No user identity, amounts, or asset information is revealed.
    /// Indexers can track intent lifecycle without learning who is depositing what.
    #[event]
    struct IntentStatusChangedEvent {
        intent_id: Field,
        new_status: u8,
    }

    /// Initializes the AaveWrapper contract with admin and portal configuration.
    ///
    /// # Arguments
    /// * `admin` - The initial admin address with privileged access
    /// * `portal_address` - The L1 portal contract address (immutable after set)
    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress, portal_address: EthAddress) {
        self.storage.admin.write(admin);
        self.storage.portal_address.initialize(portal_address);
        self.storage.nonce.write(0);
    }

    /// Initiates a deposit request to bridge assets to Aave on a target chain.
    ///
    /// This **private** function creates a cross-chain intent that will be picked up
    /// by relayers and executed on the target chain. The function:
    /// 1. Generates a unique intent_id from caller + inputs + nonce
    /// 2. Sends an L2 to L1 message to the portal with the deposit intent payload
    /// 3. Enqueues a public call to set the intent status (without revealing owner)
    ///
    /// # Privacy
    /// - The caller's identity is NEVER revealed publicly
    /// - The secret_hash binds the L1->L2 confirmation to whoever knows the secret
    /// - Only the intent_id is visible in public state, not who created it or what for
    ///
    /// # Arguments
    /// * `asset_id` - Identifier for the asset to deposit (maps to token on target chain)
    /// * `amount` - Amount of tokens to deposit (in smallest unit)
    /// * `target_chain_id` - Wormhole chain ID of the target chain (e.g., 23 for Arbitrum)
    /// * `deadline` - Unix timestamp after which the intent expires
    /// * `secret_hash` - Hash of a secret known only to the user, used to claim the confirmation
    ///
    /// # Returns
    /// * `Field` - The unique intent_id for tracking this deposit request
    ///
    /// # Note
    /// The caller must have already deposited tokens to the Aztec token portal
    /// before calling this function. The L1 portal will withdraw from the token
    /// portal when executing the deposit.
    #[external("private")]
    fn request_deposit(
        asset_id: Field,
        amount: u128,
        target_chain_id: u32,
        deadline: u64,
        secret_hash: Field,
    ) -> pub Field {
        // Get caller address for intent binding (kept private)
        let caller = self.msg_sender().unwrap();

        // Generate salt from a hash of caller + secret_hash for uniqueness without revealing caller
        // This ensures different users with same parameters get different intent_ids
        let salt_hash = poseidon2_hash([caller.to_field(), secret_hash]);
        let salt: u32 = (salt_hash as u64 & 0xFFFFFFFF) as u32;

        // Compute unique intent_id using poseidon2 hash of all inputs
        // The caller is included so intent_id is bound to the user, but since
        // poseidon2 is one-way, the caller cannot be recovered from intent_id
        let intent_id =
            compute_intent_id(caller, asset_id, amount, target_chain_id, deadline, salt);

        // Create the deposit intent struct for L2 to L1 message
        let intent =
            DepositIntent::new(intent_id, asset_id, amount, target_chain_id, deadline, salt);

        // Compute the message content hash for L2 to L1 messaging
        // Uses secret_hash instead of caller - L1 portal doesn't learn the owner
        let content = compute_deposit_message_content(intent, secret_hash);

        // Send L2 to L1 message to the portal contract
        let portal = self.storage.portal_address.read();
        self.context.message_portal(portal, content);

        // Enqueue public call to update intent status and store owner mapping
        // The owner address is passed to enable finalization routing
        AaveWrapper::at(self.context.this_address())._set_intent_pending_deposit(intent_id, caller).enqueue(
            self.context,
        );

        intent_id
    }

    /// Internal public function to set intent status to pending deposit.
    ///
    /// # Privacy
    /// This function receives the intent_id and owner address.
    /// The owner mapping enables finalization routing but doesn't reveal identity
    /// to observers since the intent_id is a one-way hash.
    /// The public state update and event reveal only that an intent exists.
    ///
    /// # Arguments
    /// * `intent_id` - The unique intent identifier
    /// * `owner` - The L2 address that created this intent
    #[external("public")]
    fn _set_intent_pending_deposit(intent_id: Field, owner: AztecAddress) {
        // Verify this intent hasn't been used before (replay protection)
        let already_consumed = self.storage.consumed_intents.at(intent_id).read();
        assert(!already_consumed, "Intent ID already consumed");

        // Store the intent owner mapping for finalization routing
        self.storage.intent_owners.at(intent_id).write(owner);

        // Set intent status to pending deposit
        self.storage.intent_status.at(intent_id).write(IntentStatus::PENDING_DEPOSIT);

        // Emit minimal event for indexers - only intent_id and status
        self.emit(IntentStatusChangedEvent { intent_id, new_status: IntentStatus::PENDING_DEPOSIT });
    }

    /// Finalizes a deposit by consuming the L1->L2 confirmation message and creating
    /// a private position receipt note.
    ///
    /// This private function is called by the user after the L1 portal has confirmed
    /// the deposit was executed on the target chain. The function:
    /// 1. Consumes the L1->L2 message (verifies L1 execution and prevents replay)
    /// 2. Creates a PositionReceiptNote with Active status
    /// 3. Inserts the note into the user's private receipt set
    /// 4. Enqueues a public call to mark the intent as consumed (without revealing owner)
    ///
    /// # Arguments
    /// * `intent_id` - The unique identifier of the deposit intent to finalize
    /// * `asset_id` - The asset identifier (must match the original deposit)
    /// * `shares` - Number of aToken shares received from Aave (reported by L1)
    /// * `target_chain_id` - Target chain ID (must match the original deposit)
    /// * `secret` - Pre-image of the secretHash used when sending the L1->L2 message
    /// * `message_leaf_index` - Index to locate the message in the L1->L2 message tree
    ///
    /// # Privacy
    /// - The note is encrypted for the caller, so only they can see their position
    /// - The public intent_status update reveals only that the intent was finalized
    /// - No user identity, amounts, or asset information is revealed publicly
    /// - Authentication is via the secret - only who knows it can claim
    #[external("private")]
    fn finalize_deposit(
        intent_id: Field,
        asset_id: Field,
        shares: u128,
        target_chain_id: u32,
        secret: Field,
        message_leaf_index: Field,
    ) {
        // Get the caller's address (the owner of the new position receipt)
        let owner = self.msg_sender().unwrap();

        // Compute the expected message content hash
        // This must match exactly what the L1 portal sent
        // Note: owner is NOT in the hash - authentication is via the secret
        let content =
            compute_deposit_confirmation_content(intent_id, asset_id, shares, target_chain_id);

        // Get the portal address for message verification
        let portal = self.storage.portal_address.read();

        // Consume the L1->L2 message
        // This will:
        // - Verify the message exists in the L1->L2 tree
        // - Verify the secret hashes to the expected secretHash
        // - Emit a nullifier to prevent double-consumption
        // - Revert if the message doesn't exist or secret is wrong
        self.context.consume_l1_to_l2_message(content, secret, portal, message_leaf_index);

        // Generate a unique nonce for the note using the intent_id
        // This ensures note uniqueness even if the same user deposits the same asset twice
        let note_nonce = intent_id;

        // Create the position receipt note with Active status
        let receipt = PositionReceiptNote {
            owner,
            nonce: note_nonce,
            asset_id,
            shares,
            target_chain_id,
            aave_market_id: 0,
            status: PositionStatus::ACTIVE,
        };

        // Insert the note into the private receipts set
        // The note is encrypted for the owner's viewing key using constrained delivery
        self.storage.receipts.at(owner).insert(receipt).deliver(MessageDelivery.CONSTRAINED_ONCHAIN);

        // Enqueue public call to mark intent as consumed
        // Only intent_id is passed - no user-identifying information
        AaveWrapper::at(self.context.this_address())._finalize_deposit_public(intent_id).enqueue(
            self.context,
        );
    }

    /// Internal public function to update intent status after deposit finalization.
    ///
    /// This is called from the private finalize_deposit to update public state.
    /// It verifies the intent was in the correct state and marks it as consumed.
    ///
    /// # Privacy
    /// This function receives ONLY the intent_id. No user identity, amounts,
    /// or asset information is passed or emitted publicly.
    ///
    /// # Arguments
    /// * `intent_id` - The intent to mark as consumed
    #[external("public")]
    fn _finalize_deposit_public(intent_id: Field) {
        // Verify the intent is in PendingDeposit status
        let status = self.storage.intent_status.at(intent_id).read();
        assert(status == IntentStatus::PENDING_DEPOSIT, "Intent not in pending deposit state");

        // Verify the intent hasn't already been consumed
        let already_consumed = self.storage.consumed_intents.at(intent_id).read();
        assert(!already_consumed, "Intent already consumed");

        // Mark the intent as consumed to prevent replay
        self.storage.consumed_intents.at(intent_id).write(true);

        // Update intent status to confirmed
        self.storage.intent_status.at(intent_id).write(IntentStatus::CONFIRMED);

        // Emit minimal event - only intent_id and status, no user data
        self.emit(IntentStatusChangedEvent { intent_id, new_status: IntentStatus::CONFIRMED });
    }

    /// Initiates a withdrawal request for an Aave position.
    ///
    /// This private function allows users to request withdrawal of their position by:
    /// 1. Finding and verifying ownership of the PositionReceiptNote by nonce
    /// 2. Verifying the receipt status is Active
    /// 3. Nullifying the Active note and creating a new note with PendingWithdraw status
    /// 4. Creating an L2-to-L1 message with the WithdrawIntent
    /// 5. Enqueuing a public call to update status (without revealing owner)
    ///
    /// # Arguments
    /// * `nonce` - The nonce of the PositionReceiptNote (same as intent_id from deposit)
    /// * `amount` - Amount of shares to withdraw
    /// * `deadline` - Unix timestamp after which the withdrawal intent expires
    /// * `secret_hash` - Hash of a secret for claiming the L1->L2 confirmation
    ///
    /// # Returns
    /// * `Field` - The intent_id for tracking this withdrawal request
    ///
    /// # Privacy
    /// - The note lookup and nullification happen privately
    /// - No user identity, amounts, or asset information is revealed publicly
    /// - The public state update reveals only that an intent status changed
    ///
    /// # Failure Modes
    /// - Note not found: If no note with matching nonce exists in the user's set
    /// - Not owner: If the caller doesn't own the note
    /// - Wrong status: If the note status is not Active
    /// - Amount exceeds shares: If requesting more than available shares
    #[external("private")]
    fn request_withdraw(
        nonce: Field,
        amount: u128,
        deadline: u64,
        secret_hash: Field,
    ) -> pub Field {
        // Get the caller's address (must be the owner of the note)
        let owner = self.msg_sender().unwrap();

        // Use pop_notes with a selector to find the note by nonce
        // The nonce field is at index 1 in the serialized note (after owner)
        // pop_notes() retrieves and nullifies notes in one operation
        let options = NoteGetterOptions::new()
            .select(PositionReceiptNote::properties().nonce, Comparator.EQ, nonce)
            .set_limit(1);

        let notes = self.storage.receipts.at(owner).pop_notes(options);

        // Ensure we found exactly one note
        assert(notes.len() == 1, "Position receipt note not found");
        let receipt = notes.get(0);

        // Verify the note is owned by the caller (should always be true due to .at(owner))
        assert(receipt.owner == owner, "Not the owner of this position");

        // Verify the receipt status is Active
        assert(receipt.status == PositionStatus::ACTIVE, "Position is not active");

        // Verify the withdrawal amount doesn't exceed available shares
        assert(amount <= receipt.shares, "Withdrawal amount exceeds available shares");

        // The intent_id for withdrawal is the note's nonce (same as the original deposit intent_id)
        let intent_id = receipt.nonce;

        // Calculate remaining shares after withdrawal
        let remaining_shares = receipt.shares - amount;

        // Create a new note with PendingWithdraw status
        // This note tracks the withdrawal in progress
        let pending_receipt = PositionReceiptNote {
            owner,
            nonce: receipt.nonce,
            asset_id: receipt.asset_id,
            shares: remaining_shares,
            target_chain_id: receipt.target_chain_id,
            aave_market_id: receipt.aave_market_id,
            status: PositionStatus::PENDING_WITHDRAW,
        };

        // Insert the pending withdrawal note
        self.storage.receipts.at(owner).insert(pending_receipt).deliver(
            MessageDelivery.CONSTRAINED_ONCHAIN,
        );

        // Create the withdraw intent for L2 to L1 message
        let intent = WithdrawIntent::new(intent_id, amount, deadline);

        // Compute the message content hash for L2 to L1 messaging
        // Uses secret_hash instead of owner - L1 relayers don't learn the owner
        let content = compute_withdraw_message_content(
            intent,
            receipt.asset_id,
            receipt.target_chain_id,
            secret_hash,
        );

        // Send L2 to L1 message to the portal contract
        let portal = self.storage.portal_address.read();
        self.context.message_portal(portal, content);

        // Enqueue public call to update intent status
        // Only intent_id is passed - no user-identifying information
        AaveWrapper::at(self.context.this_address())._request_withdraw_public(intent_id).enqueue(
            self.context,
        );

        intent_id
    }

    /// Internal public function to update intent status after withdrawal request.
    ///
    /// This is called from the private request_withdraw to update public state.
    ///
    /// # Privacy
    /// This function receives ONLY the intent_id. No user identity, amounts,
    /// or asset information is passed or emitted publicly.
    ///
    /// # Arguments
    /// * `intent_id` - The intent to mark as pending withdrawal
    #[external("public")]
    fn _request_withdraw_public(intent_id: Field) {
        // Update intent status to pending withdrawal
        // Note: We overwrite any previous status (the intent was previously CONFIRMED)
        self.storage.intent_status.at(intent_id).write(IntentStatus::PENDING_WITHDRAW);

        // Emit minimal event - only intent_id and status, no user data
        self.emit(
            IntentStatusChangedEvent { intent_id, new_status: IntentStatus::PENDING_WITHDRAW },
        );
    }

    /// Finalizes a withdrawal by consuming the L1->L2 confirmation message and nullifying
    /// the pending withdraw receipt note.
    ///
    /// This private function is called by the user after the L1 portal has confirmed
    /// the withdrawal was executed on the target chain and tokens have been bridged back.
    /// The function:
    /// 1. Consumes the L1->L2 message (verifies L1 execution and prevents replay)
    /// 2. Finds and nullifies the PendingWithdraw receipt note
    /// 3. Enqueues a public call to mark the intent as consumed (without revealing owner)
    ///
    /// Note: Token minting/claiming is handled separately by the token portal.
    /// This function only cleans up the position receipt state.
    ///
    /// # Arguments
    /// * `intent_id` - The unique identifier of the withdrawal intent to finalize
    /// * `asset_id` - The asset identifier (must match the original position)
    /// * `amount` - Amount that was withdrawn (reported by L1)
    /// * `target_chain_id` - Target chain ID (must match the original position)
    /// * `secret` - Pre-image of the secretHash used when sending the L1->L2 message
    /// * `message_leaf_index` - Index to locate the message in the L1->L2 message tree
    ///
    /// # Privacy
    /// - The note nullification happens privately
    /// - No user identity, amounts, or asset information is revealed publicly
    /// - Authentication is via the secret - only who knows it can finalize
    #[external("private")]
    fn finalize_withdraw(
        intent_id: Field,
        asset_id: Field,
        amount: u128,
        target_chain_id: u32,
        secret: Field,
        message_leaf_index: Field,
    ) {
        // Get the caller's address (must be the owner of the pending withdraw note)
        let owner = self.msg_sender().unwrap();

        // Compute the expected message content hash
        // This must match exactly what the L1 portal sent
        // Note: owner is NOT in the hash - authentication is via the secret
        let content =
            compute_withdraw_confirmation_content(intent_id, asset_id, amount, target_chain_id);

        // Get the portal address for message verification
        let portal = self.storage.portal_address.read();

        // Consume the L1->L2 message
        // This will:
        // - Verify the message exists in the L1->L2 tree
        // - Verify the secret hashes to the expected secretHash
        // - Emit a nullifier to prevent double-consumption
        // - Revert if the message doesn't exist or secret is wrong
        self.context.consume_l1_to_l2_message(content, secret, portal, message_leaf_index);

        // Find and nullify the PendingWithdraw receipt note
        // Use pop_notes with a selector to find the note by nonce (which equals intent_id)
        // and verify it has PendingWithdraw status
        let options = NoteGetterOptions::new()
            .select(PositionReceiptNote::properties().nonce, Comparator.EQ, intent_id)
            .set_limit(1);

        let notes = self.storage.receipts.at(owner).pop_notes(options);

        // Ensure we found exactly one note
        assert(notes.len() == 1, "Pending withdraw receipt note not found");
        let receipt = notes.get(0);

        // Verify the note is owned by the caller
        assert(receipt.owner == owner, "Not the owner of this position");

        // Verify the receipt status is PendingWithdraw
        assert(
            receipt.status == PositionStatus::PENDING_WITHDRAW,
            "Position is not pending withdrawal",
        );

        // Verify the asset and chain match
        assert(receipt.asset_id == asset_id, "Asset ID mismatch");
        assert(receipt.target_chain_id == target_chain_id, "Target chain ID mismatch");

        // If there are remaining shares in the note, create a new Active note
        // This handles partial withdrawals where only some shares were withdrawn
        if receipt.shares > 0 {
            let remaining_receipt = PositionReceiptNote {
                owner,
                nonce: receipt.nonce,
                asset_id: receipt.asset_id,
                shares: receipt.shares,
                target_chain_id: receipt.target_chain_id,
                aave_market_id: receipt.aave_market_id,
                status: PositionStatus::ACTIVE,
            };
            self.storage.receipts.at(owner).insert(remaining_receipt).deliver(
                MessageDelivery.CONSTRAINED_ONCHAIN,
            );
        }

        // Enqueue public call to mark intent as consumed
        // Only intent_id is passed - no user-identifying information
        AaveWrapper::at(self.context.this_address())._finalize_withdraw_public(intent_id).enqueue(
            self.context,
        );
    }

    /// Internal public function to update intent status after withdrawal finalization.
    ///
    /// This is called from the private finalize_withdraw to update public state.
    /// It verifies the intent was in the correct state and marks it as consumed.
    ///
    /// # Privacy
    /// This function receives ONLY the intent_id. No user identity, amounts,
    /// or asset information is passed or emitted publicly.
    ///
    /// # Arguments
    /// * `intent_id` - The intent to mark as consumed
    #[external("public")]
    fn _finalize_withdraw_public(intent_id: Field) {
        // Verify the intent is in PendingWithdraw status
        let status = self.storage.intent_status.at(intent_id).read();
        assert(status == IntentStatus::PENDING_WITHDRAW, "Intent not in pending withdraw state");

        // Mark the intent as consumed to prevent replay
        // Note: For withdrawals, we mark consumed here rather than keeping it open
        // because the withdrawal flow is complete
        self.storage.consumed_intents.at(intent_id).write(true);

        // Update intent status to confirmed (withdrawal complete)
        self.storage.intent_status.at(intent_id).write(IntentStatus::CONFIRMED);

        // Emit minimal event - only intent_id and status, no user data
        self.emit(IntentStatusChangedEvent { intent_id, new_status: IntentStatus::CONFIRMED });
    }
}
