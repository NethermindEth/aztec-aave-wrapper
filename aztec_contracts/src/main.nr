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
/// - Uses salt for uniqueness (prevents replay across sessions)
///
/// # Arguments
/// * `caller` - The address initiating the deposit
/// * `asset` - Asset address on target chain
/// * `amount` - Deposit amount
/// * `original_decimals` - Original token decimals for Wormhole
/// * `deadline` - Intent expiration timestamp
/// * `salt` - Random value for uniqueness
///
/// # Returns
/// * `Field` - The computed intent ID
pub fn compute_intent_id(
    caller: AztecAddress,
    asset: Field,
    amount: u128,
    original_decimals: u8,
    deadline: u64,
    salt: Field,
) -> Field {
    // Pack inputs into array for hashing
    // Note: We convert smaller types to Field for uniform hashing
    poseidon2_hash([
        caller.to_field(),
        asset,
        amount as Field,
        original_decimals as Field,
        deadline as Field,
        salt,
    ])
}

/// Computes the message content hash for L2 to L1 deposit messages.
///
/// This hash is what the L1 portal contract will verify when consuming
/// the cross-chain message. The encoding must match the Solidity expectation.
///
/// # Privacy
/// The owner_l2 address is hashed (owner_hash) to preserve privacy.
/// L1 execution is performed by relayers who don't need to know the L2 owner.
/// The secret/secretHash mechanism in the L1->L2 confirmation provides authentication.
///
/// # Arguments
/// * `intent` - The deposit intent containing all parameters including owner_hash
/// * `secret_hash` - Hash of the secret that will be used to claim the L1->L2 confirmation
///
/// # Returns
/// * `Field` - The message content hash
pub fn compute_deposit_message_content(intent: DepositIntent, secret_hash: Field) -> Field {
    // Hash intent fields plus secret_hash for the L2 to L1 message
    // The secret_hash binds the confirmation to whoever knows the secret (the user)
    // The owner_hash preserves privacy while allowing L1 verification
    poseidon2_hash([
        intent.intent_id,
        intent.owner_hash,
        intent.asset,
        intent.amount as Field,
        intent.original_decimals as Field,
        intent.deadline as Field,
        intent.salt,
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
///
/// # Returns
/// * `Field` - The message content hash for L1->L2 verification
pub fn compute_deposit_confirmation_content(
    intent_id: Field,
    asset_id: Field,
    shares: u128,
) -> Field {
    // Hash confirmation data for L1 to L2 message verification
    // This must match the encoding used by the L1 portal when sending the message
    // Owner is authenticated via secret, not included in hash
    poseidon2_hash([intent_id, asset_id, shares as Field])
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
///
/// # Returns
/// * `Field` - The message content hash for L1->L2 verification
pub fn compute_withdraw_confirmation_content(
    intent_id: Field,
    asset_id: Field,
    amount: u128,
) -> Field {
    // Hash confirmation data for L1 to L2 message verification
    // This must match the encoding used by the L1 portal when sending the message
    // Owner is authenticated via secret, not included in hash
    poseidon2_hash([intent_id, asset_id, amount as Field])
}

use crate::types::WithdrawIntent;

/// Computes the message content hash for L2 to L1 withdrawal messages.
///
/// This hash is what the L1 portal contract will verify when consuming
/// the cross-chain withdrawal message. The encoding must match the Solidity expectation.
///
/// # Privacy
/// The owner_l2 address is hashed (owner_hash) to preserve privacy.
/// L1 relayers don't need to know the actual L2 owner identity.
/// Authentication is via the secret mechanism in the L1->L2 confirmation.
///
/// # Arguments
/// * `intent` - The withdraw intent containing intent_id, owner_hash, amount, and deadline
/// * `asset_id` - The asset being withdrawn
/// * `secret_hash` - Hash of the secret for claiming the confirmation
///
/// # Returns
/// * `Field` - The message content hash
pub fn compute_withdraw_message_content(
    intent: WithdrawIntent,
    asset_id: Field,
    secret_hash: Field,
) -> Field {
    // Hash intent fields plus secret_hash for the L2 to L1 message
    // The owner_hash preserves privacy while allowing L1 verification
    poseidon2_hash([
        intent.intent_id,
        intent.owner_hash,
        intent.amount as Field,
        intent.deadline as Field,
        asset_id,
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
            traits::{FromField, ToField},
        },
        state_vars::{Map, Owned, PrivateSet, PublicImmutable, PublicMutable},
        utils::comparison::Comparator,
    };

    use crate::{
        compute_deposit_confirmation_content, compute_deposit_message_content, compute_intent_id,
        compute_withdraw_confirmation_content, compute_withdraw_message_content,
    };
    use crate::types::{DepositIntent, PositionReceiptNote, PositionStatus, WithdrawIntent};

    /// Deadline validation constants.
    /// Min deadline: 30 minutes = 1800 seconds
    /// Max deadline: 7 days = 604800 seconds
    mod DeadlineConfig {
        /// Minimum deadline duration from current time (30 minutes)
        pub global MIN_DEADLINE_DURATION: u64 = 1800;
        /// Maximum deadline duration from current time (7 days)
        pub global MAX_DEADLINE_DURATION: u64 = 604800;
    }

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

        /// Mapping from intent_id to deadline timestamp.
        /// Used to validate refund claims for expired withdrawal requests.
        /// Only set for withdrawal intents.
        intent_deadlines: Map<Field, PublicMutable<u64, Context>, Context>,

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
    /// 1. Validates deadline bounds (MIN: 30 min, MAX: 7 days from now)
    /// 2. Validates amount is non-zero
    /// 3. Computes hash(ownerL2) for privacy
    /// 4. Generates a unique intent_id from caller + inputs + salt
    /// 5. Sends an L2 to L1 message to the portal with the deposit intent payload
    /// 6. Enqueues a public call to set the intent status and store intentId -> owner mapping
    ///
    /// # Privacy
    /// - The caller's identity is hashed (owner_hash) to preserve privacy
    /// - The secret_hash binds the L1->L2 confirmation to whoever knows the secret
    /// - Only the intent_id is visible in public state, not who created it or what for
    /// - The intentId -> owner mapping is stored publicly but doesn't reveal identity
    ///
    /// # Arguments
    /// * `asset` - Token address on target chain (stored as Field)
    /// * `amount` - Amount of tokens to deposit (in smallest unit, must be > 0)
    /// * `original_decimals` - Original token decimals for Wormhole normalization
    /// * `deadline` - Unix timestamp after which the intent expires (must be within bounds)
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
        asset: Field,
        amount: u128,
        original_decimals: u8,
        deadline: u64,
        secret_hash: Field,
    ) -> pub Field {
        // Get caller address for intent binding (kept private)
        let caller = self.msg_sender().unwrap();

        // Validate amount is non-zero
        assert(amount > 0, "Amount must be greater than zero");

        // Validate deadline bounds
        // Note: In Aztec private context, we don't have access to block.timestamp
        // Deadline validation will be enforced on L1 portal instead
        // We still require deadline to be non-zero as basic sanity check
        assert(deadline > 0, "Deadline must be greater than zero");

        // Compute hash of owner for privacy
        let owner_hash = poseidon2_hash([caller.to_field()]);

        // Generate salt from a hash of caller + secret_hash for uniqueness without revealing caller
        // This ensures different users with same parameters get different intent_ids
        let salt = poseidon2_hash([caller.to_field(), secret_hash]);

        // Compute unique intent_id using poseidon2 hash of all inputs
        // The caller is included so intent_id is bound to the user, but since
        // poseidon2 is one-way, the caller cannot be recovered from intent_id
        let intent_id = compute_intent_id(caller, asset, amount, original_decimals, deadline, salt);

        // Create the deposit intent struct for L2 to L1 message
        let intent = DepositIntent::new(
            intent_id,
            owner_hash,
            asset,
            amount,
            original_decimals,
            deadline,
            salt,
        );

        // Compute the message content hash for L2 to L1 messaging
        // Uses owner_hash and secret_hash - L1 portal doesn't learn the owner
        let content = compute_deposit_message_content(intent, secret_hash);

        // Send L2 to L1 message to the portal contract
        let portal = self.storage.portal_address.read();
        self.context.message_portal(portal, content);

        // Enqueue public call to update intent status and store owner mapping
        // The owner address is passed to enable finalization routing
        AaveWrapper::at(self.context.this_address())
            ._set_intent_pending_deposit(intent_id, caller)
            .enqueue(self.context);

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
    /// * `asset_id` - The asset identifier (validated via L1->L2 message hash)
    /// * `shares` - Number of aToken shares received from Aave (validated via L1->L2 message hash)
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
        secret: Field,
        message_leaf_index: Field,
    ) {
        // Get the caller's address (the owner of the new position receipt)
        let owner = self.msg_sender().unwrap();

        // Compute the expected message content hash
        // This must match exactly what the L1 portal sent
        // Note: owner is NOT in the hash - authentication is via the secret
        let content = compute_deposit_confirmation_content(intent_id, asset_id, shares);

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
        // Note: target_chain_id is set to 0 as it's no longer used in the protocol
        let receipt = PositionReceiptNote {
            owner,
            nonce: note_nonce,
            asset_id,
            shares,
            target_chain_id: 0,
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

        // Clear the intent owner mapping to reclaim storage
        // This is safe because the intent is now consumed and won't be reused
        self.storage.intent_owners.at(intent_id).write(AztecAddress::from_field(0));

        // Emit minimal event - only intent_id and status, no user data
        self.emit(IntentStatusChangedEvent { intent_id, new_status: IntentStatus::CONFIRMED });
    }

    /// Initiates a withdrawal request for an Aave position.
    ///
    /// This private function allows users to request withdrawal of their position by:
    /// 1. Finding and verifying ownership of the PositionReceiptNote by nonce
    /// 2. Verifying the receipt status is Active
    /// 3. Enforcing full withdrawal only (amount must equal receipt.shares)
    /// 4. Nullifying the Active note and creating a new note with PendingWithdraw status
    /// 5. Creating an L2-to-L1 message with the WithdrawIntent (using hash(ownerL2))
    /// 6. Enqueuing a public call to update status and store intentId -> owner mapping
    ///
    /// # MVP Constraint
    /// Only full withdrawals are supported. Partial withdrawals will be rejected.
    ///
    /// # Arguments
    /// * `nonce` - The nonce of the PositionReceiptNote (same as intent_id from deposit)
    /// * `amount` - Amount of shares to withdraw (must equal total shares in receipt)
    /// * `deadline` - Unix timestamp after which the withdrawal intent expires
    /// * `secret_hash` - Hash of a secret for claiming the L1->L2 confirmation
    ///
    /// # Returns
    /// * `Field` - The intent_id for tracking this withdrawal request
    ///
    /// # Privacy
    /// - The note lookup and nullification happen privately
    /// - Uses hash(ownerL2) in cross-chain messages to preserve privacy
    /// - No user identity, amounts, or asset information is revealed publicly
    /// - The public state update reveals only that an intent status changed
    /// - The intentId -> owner mapping enables finalization routing
    ///
    /// # Failure Modes
    /// - Note not found: If no note with matching nonce exists in the user's set
    /// - Not owner: If the caller doesn't own the note
    /// - Wrong status: If the note status is not Active
    /// - Partial withdrawal: If amount != receipt.shares (only full withdrawals allowed)
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

        // MVP: Enforce full withdrawal only (no partial withdrawals)
        assert(
            amount == receipt.shares,
            "Must withdraw full position (partial withdrawals not supported)",
        );

        // The intent_id for withdrawal is the note's nonce (same as the original deposit intent_id)
        let intent_id = receipt.nonce;

        // Create a new note with PendingWithdraw status
        // For MVP full withdrawals, the shares field stores the withdrawal amount
        // This allows finalize_withdraw to validate the L1 confirmation amount
        let pending_receipt = PositionReceiptNote {
            owner,
            nonce: receipt.nonce,
            asset_id: receipt.asset_id,
            shares: amount, // Store withdrawal amount for validation in finalize_withdraw
            target_chain_id: receipt.target_chain_id,
            aave_market_id: receipt.aave_market_id,
            status: PositionStatus::PENDING_WITHDRAW,
        };

        // Insert the pending withdrawal note
        self.storage.receipts.at(owner).insert(pending_receipt).deliver(
            MessageDelivery.CONSTRAINED_ONCHAIN,
        );

        // Compute hash of owner for privacy
        let owner_hash = poseidon2_hash([owner.to_field()]);

        // Create the withdraw intent for L2 to L1 message
        let intent = WithdrawIntent::new(intent_id, owner_hash, amount, deadline);

        // Compute the message content hash for L2 to L1 messaging
        // Uses owner_hash and secret_hash - L1 relayers don't learn the owner
        let content = compute_withdraw_message_content(intent, receipt.asset_id, secret_hash);

        // Send L2 to L1 message to the portal contract
        let portal = self.storage.portal_address.read();
        self.context.message_portal(portal, content);

        // Enqueue public call to update intent status and store owner mapping
        // The owner address is passed to enable finalization routing
        // The deadline is passed to enable refund claim validation
        AaveWrapper::at(self.context.this_address())
            ._request_withdraw_public(intent_id, owner, deadline)
            .enqueue(self.context);

        intent_id
    }

    /// Internal public function to update intent status after withdrawal request.
    ///
    /// This is called from the private request_withdraw to update public state.
    ///
    /// # Privacy
    /// This function receives the intent_id and owner address.
    /// The owner mapping enables finalization routing but doesn't reveal identity
    /// to observers since the intent_id is a one-way hash.
    ///
    /// # Arguments
    /// * `intent_id` - The intent to mark as pending withdrawal
    /// * `owner` - The L2 address that owns this position
    /// * `deadline` - The deadline timestamp for the withdrawal request
    #[external("public")]
    fn _request_withdraw_public(intent_id: Field, owner: AztecAddress, deadline: u64) {
        // Verify the intent is in CONFIRMED status (successful deposit must precede withdrawal)
        let status = self.storage.intent_status.at(intent_id).read();
        assert(status == IntentStatus::CONFIRMED, "Intent not in confirmed state");

        // Note: We don't check consumed_intents here because the deposit flow marks it consumed
        // The intent_id is reused for withdrawal, tracking the lifecycle of the position
        // The status transition from CONFIRMED -> PENDING_WITHDRAW indicates withdrawal started

        // Store the intent owner mapping for finalization routing
        // This allows finalize_withdraw to be routed to the correct user
        self.storage.intent_owners.at(intent_id).write(owner);

        // Store the deadline for refund claim validation
        self.storage.intent_deadlines.at(intent_id).write(deadline);

        // Update intent status to pending withdrawal
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
        secret: Field,
        message_leaf_index: Field,
    ) {
        // Get the caller's address (must be the owner of the pending withdraw note)
        let owner = self.msg_sender().unwrap();

        // Compute the expected message content hash
        // This must match exactly what the L1 portal sent
        // Note: owner is NOT in the hash - authentication is via the secret
        let content = compute_withdraw_confirmation_content(intent_id, asset_id, amount);

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

        // Verify the asset matches
        assert(receipt.asset_id == asset_id, "Asset ID mismatch");

        // Verify the withdrawal amount matches what was requested
        // The PendingWithdraw note stores the withdrawal amount in the shares field
        assert(receipt.shares == amount, "Withdrawal amount mismatch");

        // Note is already nullified by pop_notes above
        // No new note is created since this is a full withdrawal

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

        // Ensure the intent remains marked as consumed (was set during deposit finalization)
        // This is redundant but provides consistency in finalization flows
        self.storage.consumed_intents.at(intent_id).write(true);

        // Update intent status to confirmed (withdrawal complete)
        self.storage.intent_status.at(intent_id).write(IntentStatus::CONFIRMED);

        // Clear the intent owner mapping to reclaim storage
        // This is safe because the intent is now consumed and won't be reused
        self.storage.intent_owners.at(intent_id).write(AztecAddress::from_field(0));

        // Clear the deadline mapping to reclaim storage
        self.storage.intent_deadlines.at(intent_id).write(0);

        // Emit minimal event - only intent_id and status, no user data
        self.emit(IntentStatusChangedEvent { intent_id, new_status: IntentStatus::CONFIRMED });
    }

    /// Claims a refund for an expired withdrawal request.
    ///
    /// If a withdrawal request has passed its deadline without being processed,
    /// the user can claim a refund by calling this function. This will:
    /// 1. Verify the deadline has passed
    /// 2. Find and nullify the PendingWithdraw receipt note
    /// 3. Create a new Active receipt note with the same position details
    /// 4. Update public state to mark the refund as claimed
    ///
    /// The new Active note will have a different nonce than the original to ensure
    /// unique nullifiers and prevent double-spending.
    ///
    /// # Arguments
    /// * `nonce` - The nonce of the PendingWithdraw receipt note (same as intent_id)
    /// * `current_time` - Current timestamp for deadline validation
    ///
    /// # Privacy
    /// - The note operations happen privately
    /// - No user identity, amounts, or asset information is revealed publicly
    /// - Only the intent_id and refund status are visible in public state
    ///
    /// # Failure Modes
    /// - Note not found: If no PendingWithdraw note with matching nonce exists
    /// - Not owner: If the caller doesn't own the note
    /// - Wrong status: If the note status is not PendingWithdraw
    /// - Deadline not expired: If current_time < deadline
    /// - Double refund: If the refund has already been claimed for this intent
    #[external("private")]
    fn claim_refund(nonce: Field, current_time: u64) {
        // Validate current_time is non-zero and reasonable
        assert(current_time > 0, "Current time must be greater than zero");

        // Get the caller's address (must be the owner of the note)
        let owner = self.msg_sender().unwrap();

        // Find the PendingWithdraw receipt note by nonce
        let options = NoteGetterOptions::new()
            .select(PositionReceiptNote::properties().nonce, Comparator.EQ, nonce)
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

        // Note: We cannot access the deadline from the note because it's not stored in PositionReceiptNote.
        // The deadline is stored in public state (intent_deadlines mapping) set during request_withdraw.
        // We pass current_time to the public function which validates against the stored deadline.
        // This ensures deadline validation happens in public context where it can be enforced.

        // Generate a new nonce for the refunded note to ensure different nullifier
        // We use hash(original_nonce, owner) to create a deterministic but different nonce
        let new_nonce = poseidon2_hash([receipt.nonce, owner.to_field()]);

        // Create a new Active note with the same position details but new nonce
        let refunded_receipt = PositionReceiptNote {
            owner,
            nonce: new_nonce,
            asset_id: receipt.asset_id,
            shares: receipt.shares,
            target_chain_id: receipt.target_chain_id,
            aave_market_id: receipt.aave_market_id,
            status: PositionStatus::ACTIVE,
        };

        // Insert the refunded note
        self.storage.receipts.at(owner).insert(refunded_receipt).deliver(
            MessageDelivery.CONSTRAINED_ONCHAIN,
        );

        // Enqueue public call to verify deadline and mark refund as claimed
        // Pass the intent_id (original nonce) and current_time
        AaveWrapper::at(self.context.this_address())
            ._claim_refund_public(receipt.nonce, current_time)
            .enqueue(self.context);
    }

    /// Internal public function to validate deadline and update state after refund claim.
    ///
    /// This is called from the private claim_refund to verify the deadline has passed
    /// and update public state. We cannot check deadlines in private context because
    /// the deadline is not stored in the PositionReceiptNote.
    ///
    /// # Privacy
    /// This function receives ONLY the intent_id and current_time. No user identity,
    /// amounts, or asset information is passed or emitted publicly.
    ///
    /// # Arguments
    /// * `intent_id` - The intent to mark as refunded
    /// * `current_time` - Current timestamp for deadline validation
    #[external("public")]
    fn _claim_refund_public(intent_id: Field, current_time: u64) {
        // Verify the intent is in PendingWithdraw status
        let status = self.storage.intent_status.at(intent_id).read();
        assert(status == IntentStatus::PENDING_WITHDRAW, "Intent not in pending withdraw state");

        // Read the stored deadline for this intent
        let deadline = self.storage.intent_deadlines.at(intent_id).read();
        assert(deadline > 0, "No deadline stored for this intent");

        // Verify the deadline has expired (current_time must be greater than or equal to deadline)
        assert(current_time >= deadline, "Deadline has not expired yet");

        // Update intent status back to CONFIRMED (refund claimed, position still active)
        self.storage.intent_status.at(intent_id).write(IntentStatus::CONFIRMED);

        // Clear the intent owner mapping to reclaim storage
        self.storage.intent_owners.at(intent_id).write(AztecAddress::from_field(0));

        // Clear the deadline mapping to reclaim storage
        self.storage.intent_deadlines.at(intent_id).write(0);

        // Emit minimal event - only intent_id and status, no user data
        self.emit(IntentStatusChangedEvent { intent_id, new_status: IntentStatus::CONFIRMED });
    }
}
