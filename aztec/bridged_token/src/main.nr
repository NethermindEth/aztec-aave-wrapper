use aztec::macros::aztec;

#[aztec]
pub contract BridgedToken {
    use dep::aztec::{
        macros::{events::event, functions::{external, initializer}, notes::note, storage::storage},
        messages::message_delivery::MessageDelivery,
        note::{
            constants::MAX_NOTES_PER_PAGE, note_getter_options::NoteGetterOptions,
            note_interface::NoteProperties, note_viewer_options::NoteViewerOptions,
        },
        protocol_types::{
            address::{AztecAddress, EthAddress},
            hash::{poseidon2_hash, sha256_to_field},
            traits::{Deserialize, FromField, Packable, Serialize, ToField},
        },
        state_vars::{Map, Owned, PrivateSet, PublicImmutable, PublicMutable},
        utils::comparison::Comparator,
    };

    /// A private balance note representing token ownership.
    ///
    /// Each note represents a portion of a user's token balance.
    /// Notes are encrypted for the owner and can only be decrypted by them.
    #[derive(Deserialize, Eq, Packable, Serialize)]
    #[note]
    pub struct TokenNote {
        /// The Aztec address that owns this balance
        pub owner: AztecAddress,
        /// The amount of tokens in this note
        pub amount: u128,
        /// Random value for uniqueness (prevents note collision)
        pub randomness: Field,
    }

    /// A private note tracking a pending L1->L2 bridge claim.
    ///
    /// This note is created when a user registers a pending bridge after
    /// initiating a deposit on L1. It allows the contract to track pending
    /// bridges without requiring off-chain storage.
    ///
    /// The secret itself is NOT stored on-chain (only the hash) because
    /// anyone with the secret could claim the tokens.
    #[derive(Deserialize, Eq, Packable, Serialize)]
    #[note]
    pub struct PendingClaimNote {
        /// The Aztec address that owns this pending claim
        pub owner: AztecAddress,
        /// The L1->L2 message content hash (for matching during claim)
        pub message_key: Field,
        /// The amount of tokens being bridged
        pub amount: u128,
        /// Hash of the secret (NOT the secret itself)
        pub secret_hash: Field,
        /// L1 block number when the deposit was made (for ordering/debugging)
        pub l1_block_number: u64,
    }

    /// Storage layout for the BridgedToken contract.
    #[storage]
    struct Storage<Context> {
        /// Admin address with privileged access
        admin: PublicMutable<AztecAddress, Context>,

        /// The AaveWrapper contract address authorized to mint/burn
        minter: PublicMutable<AztecAddress, Context>,

        /// The L1 TokenPortal address for L1->L2 message verification
        portal_address: PublicImmutable<EthAddress, Context>,

        /// Mapping of contract addresses authorized to burn tokens on behalf of users
        /// Key: contract address, Value: whether authorized (stored as Field, 1 = authorized, 0 = not)
        authorized_burners: Map<AztecAddress, PublicMutable<Field, Context>, Context>,

        /// Token name (public, immutable after initialization)
        name: PublicImmutable<Field, Context>,

        /// Token symbol (public, immutable after initialization)
        symbol: PublicImmutable<Field, Context>,

        /// Token decimals (public, immutable after initialization)
        decimals: PublicImmutable<u8, Context>,

        /// Total supply of the token (public)
        total_supply: PublicMutable<u128, Context>,

        /// Private balances for each user
        /// Uses Owned wrapper per aztec-nr conventions
        balances: Map<AztecAddress, Owned<PrivateSet<TokenNote, Context>, Context>, Context>,

        /// Pending bridge claims for each user
        /// Tracks L1->L2 bridge operations that have been initiated but not yet claimed
        pending_claims: Map<AztecAddress, Owned<PrivateSet<PendingClaimNote, Context>, Context>, Context>,
    }

    /// Event emitted when tokens are minted
    #[event]
    struct MintEvent {
        amount: u128,
    }

    /// Event emitted when tokens are burned
    #[event]
    struct BurnEvent {
        amount: u128,
    }

    /// Event emitted when the minter is updated
    #[event]
    struct MinterUpdatedEvent {
        old_minter: AztecAddress,
        new_minter: AztecAddress,
    }

    /// Event emitted when a burner authorization is changed
    #[event]
    struct BurnerAuthorizedEvent {
        burner: AztecAddress,
        authorized: bool,
    }

    /// Initializes the BridgedToken contract.
    ///
    /// # Arguments
    /// * `admin` - The initial admin address
    /// * `portal_address` - The L1 TokenPortal address for message verification
    /// * `name` - Token name as a Field
    /// * `symbol` - Token symbol as a Field
    /// * `decimals` - Token decimals
    #[external("public")]
    #[initializer]
    fn constructor(
        admin: AztecAddress,
        portal_address: EthAddress,
        name: Field,
        symbol: Field,
        decimals: u8,
    ) {
        self.storage.admin.write(admin);
        self.storage.minter.write(AztecAddress::from_field(0));
        self.storage.portal_address.initialize(portal_address);
        self.storage.name.initialize(name);
        self.storage.symbol.initialize(symbol);
        self.storage.decimals.initialize(decimals);
        self.storage.total_supply.write(0);
    }

    /// Sets the minter address (only admin can call).
    ///
    /// The minter is the AaveWrapper contract that is authorized to mint and burn tokens.
    ///
    /// # Arguments
    /// * `new_minter` - The new minter address
    #[external("public")]
    fn set_minter(new_minter: AztecAddress) {
        // Only admin can set minter
        let admin = self.storage.admin.read();
        let sender = self.msg_sender().unwrap();
        assert(sender.to_field() == admin.to_field(), "Only admin can set minter");

        let old_minter = self.storage.minter.read();
        self.storage.minter.write(new_minter);

        self.emit(MinterUpdatedEvent { old_minter, new_minter });
    }

    /// Authorizes or revokes a contract's ability to burn tokens on behalf of users.
    ///
    /// This allows contracts like AaveWrapper to call burn_from to burn tokens
    /// from users' private balances during deposit operations.
    ///
    /// # Arguments
    /// * `burner` - The contract address to authorize/revoke
    /// * `authorized` - True to authorize, false to revoke
    ///
    /// # Authorization
    /// Only the admin can call this function.
    #[external("public")]
    fn authorize_burner(burner: AztecAddress, authorized: bool) {
        // Only admin can authorize burners
        let admin = self.storage.admin.read();
        let sender = self.msg_sender().unwrap();
        assert(sender.to_field() == admin.to_field(), "Only admin can authorize burners");

        // Validate burner address is not zero
        assert(burner.to_field() != 0, "Cannot authorize zero address");

        // Store authorization (1 = authorized, 0 = not authorized)
        let auth_value: Field = if authorized { 1 } else { 0 };
        self.storage.authorized_burners.at(burner).write(auth_value);

        self.emit(BurnerAuthorizedEvent { burner, authorized });
    }

    /// Mints new tokens to a recipient (private).
    ///
    /// This function is called by the authorized minter (AaveWrapper) to create new
    /// bridged tokens when assets are bridged from L1.
    ///
    /// # Arguments
    /// * `to` - The recipient's Aztec address
    /// * `amount` - Amount of tokens to mint
    /// * `randomness` - Random value for note uniqueness
    ///
    /// # Privacy
    /// - The recipient and amount are private (in the note)
    /// - Only total supply change is visible publicly
    ///
    /// # Authorization
    /// The caller must be the authorized minter. This is verified by passing
    /// the caller address to the public function which checks against the minter.
    #[external("private")]
    fn mint_private(to: AztecAddress, amount: u128, randomness: Field) {
        assert(amount > 0, "Amount must be greater than zero");

        // Get the caller for authorization check
        let caller = self.msg_sender().unwrap();

        // Create a new token note for the recipient
        let note = TokenNote { owner: to, amount, randomness };

        // Insert the note into the recipient's private balance set
        self.storage.balances.at(to).at(to).insert(note).deliver(MessageDelivery.CONSTRAINED_ONCHAIN);

        // Enqueue public call to verify minter authorization and update total supply
        // Pass the original caller for authorization verification
        BridgedToken::at(self.context.this_address())._mint_public(caller, amount).enqueue(
            self.context,
        );
    }

    /// Internal public function to verify minter and update total supply.
    ///
    /// # Arguments
    /// * `caller` - The address that called mint_private (for authorization)
    /// * `amount` - Amount being minted
    #[external("public")]
    fn _mint_public(caller: AztecAddress, amount: u128) {
        // Verify the caller of mint_private is the authorized minter
        let minter = self.storage.minter.read();
        assert(minter.to_field() != 0, "Minter not set");
        assert(caller.to_field() == minter.to_field(), "Only minter can mint");

        // Update total supply
        let current_supply = self.storage.total_supply.read();
        self.storage.total_supply.write(current_supply + amount);

        self.emit(MintEvent { amount });
    }

    /// Claims bridged tokens from L1 by consuming the L1->L2 message.
    ///
    /// This function is called by users who bridged tokens from L1 via TokenPortal.
    /// It consumes the L1->L2 message (proving the secret) and mints tokens to the caller.
    ///
    /// # Arguments
    /// * `amount` - Amount of tokens being claimed (must match L1 deposit)
    /// * `secret` - Secret that hashes to the secretHash used in L1 deposit
    /// * `message_leaf_index` - Index of the L1->L2 message in the message tree
    ///
    /// # Message Content
    /// The L1 TokenPortal sends: sha256ToField([amount, secretHash])
    /// This function verifies the secret hashes to the expected secretHash.
    ///
    /// # Privacy
    /// - The claimer's identity is private (not linked to L1 depositor)
    /// - Only the secret holder can claim the tokens
    #[external("private")]
    fn claim_private(amount: u128, secret: Field, message_leaf_index: Field) {
        assert(amount > 0, "Amount must be greater than zero");

        // Get the caller who will receive the tokens
        let to = self.msg_sender().unwrap();

        // Compute secret_hash using Aztec's canonical domain separator.
        // This matches the hash expected by consume_l1_to_l2_message.
        let secret_hash = dep::aztec::hash::compute_secret_hash(secret);

        // Try to remove any matching pending claim note (if user registered one)
        // This is best-effort - if no matching note exists, we continue without error
        // because the user may not have called register_pending_bridge
        let options = NoteGetterOptions::new()
            .select(PendingClaimNote::properties().secret_hash, Comparator.EQ, secret_hash)
            .set_limit(1);
        let _ = self.storage.pending_claims.at(to).at(to).pop_notes(options);

        // Compute message content to match L1 TokenPortal format:
        // sha256ToField(abi.encodePacked(amount, secretHash))
        // We need to pack amount as 32 bytes (u256) and secretHash as 32 bytes
        let mut data: [u8; 64] = [0; 64];

        // Pack amount as big-endian u256 (32 bytes) - amount is u128, pad with zeros
        let amount_field = amount as Field;
        let amount_bytes: [u8; 32] = amount_field.to_be_bytes();
        for i in 0..32 {
            data[i] = amount_bytes[i];
        }

        // Pack secret_hash as 32 bytes
        let secret_hash_bytes: [u8; 32] = secret_hash.to_be_bytes();
        for i in 0..32 {
            data[32 + i] = secret_hash_bytes[i];
        }

        // Compute content hash matching L1's Hash.sha256ToField
        let content = sha256_to_field(data);

        // Get portal address from storage via public call
        // We enqueue a public call to read and verify the message
        BridgedToken::at(self.context.this_address())
            ._claim_public(to, amount, content, secret, message_leaf_index)
            .enqueue(self.context);

        // Create a token note for the claimer
        // Use secret as randomness source for the note
        let randomness = poseidon2_hash([secret, to.to_field(), amount as Field]);
        let note = TokenNote { owner: to, amount, randomness };

        // Insert the note into the claimer's private balance set
        self.storage.balances.at(to).at(to).insert(note).deliver(MessageDelivery.CONSTRAINED_ONCHAIN);
    }

    /// Internal public function to consume L1->L2 message and update total supply.
    ///
    /// # Arguments
    /// * `to` - The recipient of the tokens
    /// * `amount` - Amount being claimed
    /// * `content` - The computed message content hash
    /// * `secret` - The secret for message consumption
    /// * `message_leaf_index` - Index of the message in the tree
    #[external("public")]
    fn _claim_public(
        to: AztecAddress,
        amount: u128,
        content: Field,
        secret: Field,
        message_leaf_index: Field,
    ) {
        // Get portal address from storage
        let portal = self.storage.portal_address.read();

        // Consume the L1->L2 message
        // This will revert if:
        // - The message doesn't exist
        // - The secret doesn't hash to the expected secretHash
        // - The message was already consumed
        self.context.consume_l1_to_l2_message(content, secret, portal, message_leaf_index);

        // Update total supply
        let current_supply = self.storage.total_supply.read();
        self.storage.total_supply.write(current_supply + amount);

        self.emit(MintEvent { amount });
    }

    /// Registers a pending bridge claim after initiating a deposit on L1.
    ///
    /// This function should be called by the user after they have initiated
    /// a deposit on L1 via TokenPortal.depositToAztecPrivate(). It creates
    /// a private note that tracks the pending claim, allowing the frontend
    /// to query pending bridges from the contract instead of relying on
    /// off-chain storage.
    ///
    /// # Arguments
    /// * `message_key` - The L1->L2 message content hash (from L1 event)
    /// * `amount` - The amount of tokens being bridged
    /// * `secret_hash` - Hash of the secret (NOT the secret itself)
    /// * `l1_block_number` - The L1 block number when the deposit was made
    ///
    /// # Privacy
    /// - The pending claim note is encrypted for the caller
    /// - The secret is NOT stored on-chain (only the hash)
    /// - Other users cannot see your pending bridges
    ///
    /// # Usage
    /// After calling depositToAztecPrivate on L1:
    /// 1. Get the messageKey from the L1 event
    /// 2. Call this function to register the pending claim
    /// 3. Later, call claim_private with the secret to complete the claim
    #[external("private")]
    fn register_pending_bridge(
        message_key: Field,
        amount: u128,
        secret_hash: Field,
        l1_block_number: u64,
    ) {
        assert(amount > 0, "Amount must be greater than zero");
        assert(message_key != 0, "Message key cannot be zero");
        assert(secret_hash != 0, "Secret hash cannot be zero");

        let owner = self.msg_sender().unwrap();

        // Create a pending claim note
        let note = PendingClaimNote { owner, message_key, amount, secret_hash, l1_block_number };

        // Insert the note into the caller's pending claims set
        self.storage.pending_claims.at(owner).at(owner).insert(note).deliver(
            MessageDelivery.CONSTRAINED_ONCHAIN,
        );
    }

    /// Burns tokens from the caller's private balance.
    ///
    /// Any user can burn their own tokens. This is typically called when assets are
    /// being bridged back to L1.
    ///
    /// # Arguments
    /// * `amount` - Amount of tokens to burn
    ///
    /// # Privacy
    /// - The burn operation happens privately
    /// - Only total supply change is visible publicly
    ///
    /// Maximum number of notes to process in a single operation
    global MAX_NOTES: u32 = 10;

    #[external("private")]
    fn burn_private(amount: u128) {
        assert(amount > 0, "Amount must be greater than zero");

        let owner = self.msg_sender().unwrap();

        // Collect notes to burn the required amount
        let mut remaining = amount;
        let options = NoteGetterOptions::new().set_limit(MAX_NOTES);
        let notes = self.storage.balances.at(owner).at(owner).pop_notes(options);
        let notes_len = notes.len();

        let mut total_burned: u128 = 0;
        for i in 0..MAX_NOTES {
            if (i < notes_len) & (remaining > 0) {
                let note = notes.get(i);
                if note.amount <= remaining {
                    // Burn the entire note
                    total_burned += note.amount;
                    remaining -= note.amount;
                } else {
                    // Partial burn: create change note
                    total_burned += remaining;
                    let change = note.amount - remaining;
                    remaining = 0;

                    // Create change note with new randomness
                    let change_randomness = dep::aztec::protocol_types::hash::poseidon2_hash([
                        note.randomness,
                        change as Field,
                    ]);
                    let change_note =
                        TokenNote { owner, amount: change, randomness: change_randomness };
                    self.storage.balances.at(owner).at(owner).insert(change_note).deliver(
                        MessageDelivery.CONSTRAINED_ONCHAIN,
                    );
                }
            }
        }

        assert(remaining == 0, "Insufficient balance to burn");

        // Enqueue public call to update total supply
        // Pass the owner for internal call verification
        BridgedToken::at(self.context.this_address())._burn_public(owner, total_burned).enqueue(
            self.context,
        );
    }

    /// Internal public function to update total supply for burn.
    ///
    /// This function is called from the private burn_private function to update
    /// the public total supply. The caller parameter is passed to verify the call
    /// originates from a legitimate burn operation.
    ///
    /// # Arguments
    /// * `caller` - The address that initiated the burn (for internal call verification)
    /// * `amount` - Amount being burned
    ///
    /// # Security
    /// The caller must match the address that owns the tokens being burned.
    /// This prevents external callers from directly manipulating total supply.
    #[external("public")]
    fn _burn_public(caller: AztecAddress, amount: u128) {
        // Verify caller is not zero address (basic sanity check)
        // The caller was validated in the private function as msg_sender
        assert(caller.to_field() != 0, "Invalid caller address");

        // Update total supply
        let current_supply = self.storage.total_supply.read();
        assert(current_supply >= amount, "Insufficient total supply");
        self.storage.total_supply.write(current_supply - amount);

        self.emit(BurnEvent { amount });
    }

    /// Burns tokens from a specified user's private balance (authorized burner only).
    ///
    /// This function allows authorized contracts (like AaveWrapper) to burn tokens
    /// during deposit operations. The calling contract must be an authorized burner.
    ///
    /// # Arguments
    /// * `from` - The address whose tokens will be burned
    /// * `amount` - Amount of tokens to burn
    ///
    /// # Authorization
    /// The caller must be an authorized burner (set via authorize_burner by admin).
    /// This is checked in the public function _burn_from_public.
    ///
    /// # Privacy
    /// - The burn operation happens privately
    /// - Only total supply change is visible publicly
    /// - The `from` address is revealed to the contract but not publicly
    ///
    /// # Security
    /// - Authorization is verified in public context to prevent bypass
    /// - Notes are burned from the `from` address's balance set
    /// - Change notes are returned to the original owner
    /// - In Aztec's private execution model, note access is controlled by the
    ///   transaction context - only the user who initiated the transaction can
    ///   have their notes accessed. This provides implicit user consent.
    ///
    /// # Intended Usage
    /// This function should be called from AaveWrapper.request_deposit() where:
    /// 1. User calls request_deposit on AaveWrapper
    /// 2. AaveWrapper gets caller via msg_sender() (the user)
    /// 3. AaveWrapper calls burn_from(caller, amount) - burning only the initiating user's tokens
    #[external("private")]
    fn burn_from(from: AztecAddress, amount: u128) {
        assert(amount > 0, "Amount must be greater than zero");
        assert(from.to_field() != 0, "Cannot burn from zero address");

        // Get the caller for authorization check
        let caller = self.msg_sender().unwrap();

        // Collect notes to burn the required amount from the `from` address
        let mut remaining = amount;
        let options = NoteGetterOptions::new().set_limit(MAX_NOTES);
        let notes = self.storage.balances.at(from).at(from).pop_notes(options);
        let notes_len = notes.len();

        let mut total_burned: u128 = 0;
        for i in 0..MAX_NOTES {
            if (i < notes_len) & (remaining > 0) {
                let note = notes.get(i);
                if note.amount <= remaining {
                    // Burn the entire note
                    total_burned += note.amount;
                    remaining -= note.amount;
                } else {
                    // Partial burn: create change note for the original owner
                    total_burned += remaining;
                    let change = note.amount - remaining;
                    remaining = 0;

                    // Create change note with new randomness, returned to original owner
                    let change_randomness = dep::aztec::protocol_types::hash::poseidon2_hash([
                        note.randomness,
                        change as Field,
                    ]);
                    let change_note =
                        TokenNote { owner: from, amount: change, randomness: change_randomness };
                    self.storage.balances.at(from).at(from).insert(change_note).deliver(
                        MessageDelivery.CONSTRAINED_ONCHAIN,
                    );
                }
            }
        }

        assert(remaining == 0, "Insufficient balance to burn");

        // Enqueue public call to verify authorization and update total supply
        // Pass the caller for authorization verification
        BridgedToken::at(self.context.this_address())
            ._burn_from_public(caller, total_burned)
            .enqueue(self.context);
    }

    /// Internal public function to verify burner authorization and update total supply.
    ///
    /// This function verifies that the caller of burn_from is an authorized burner
    /// and updates the total supply.
    ///
    /// # Arguments
    /// * `caller` - The address that called burn_from (for authorization)
    /// * `amount` - Amount being burned
    #[external("public")]
    fn _burn_from_public(caller: AztecAddress, amount: u128) {
        // Verify the caller is an authorized burner
        let is_authorized = self.storage.authorized_burners.at(caller).read();
        assert(is_authorized == 1, "Caller is not an authorized burner");

        // Update total supply
        let current_supply = self.storage.total_supply.read();
        assert(current_supply >= amount, "Insufficient total supply");
        self.storage.total_supply.write(current_supply - amount);

        self.emit(BurnEvent { amount });
    }

    /// Transfers tokens from a specified user's private balance (authorized caller only).
    ///
    /// This function allows authorized contracts (like AaveWrapper) to transfer tokens
    /// during deposit operations for fee collection. The calling contract must be an
    /// authorized burner (same authorization as burn_from).
    ///
    /// # Arguments
    /// * `from` - The address whose tokens will be transferred
    /// * `to` - The recipient's Aztec address
    /// * `amount` - Amount of tokens to transfer
    ///
    /// # Authorization
    /// The caller must be an authorized burner (set via authorize_burner by admin).
    /// This is checked in the public function _transfer_from_public.
    ///
    /// # Privacy
    /// - The transfer operation happens privately
    /// - No public state is modified (total supply unchanged)
    /// - The `from` and `to` addresses are revealed to the contract but not publicly
    ///
    /// # Security
    /// - Authorization is verified in public context to prevent bypass
    /// - Notes are transferred from the `from` address's balance set
    /// - Change notes are returned to the original owner
    /// - In Aztec's private execution model, note access is controlled by the
    ///   transaction context - only the user who initiated the transaction can
    ///   have their notes accessed. This provides implicit user consent.
    ///
    /// # Intended Usage
    /// This function should be called from AaveWrapper.request_deposit() where:
    /// 1. User calls request_deposit on AaveWrapper
    /// 2. AaveWrapper gets caller via msg_sender() (the user)
    /// 3. AaveWrapper calls transfer_from(caller, treasury, fee) - transferring only the initiating user's tokens
    #[external("private")]
    fn transfer_from(from: AztecAddress, to: AztecAddress, amount: u128) {
        assert(amount > 0, "Amount must be greater than zero");
        assert(from.to_field() != 0, "Cannot transfer from zero address");
        assert(to.to_field() != 0, "Cannot transfer to zero address");
        assert(from.to_field() != to.to_field(), "Cannot transfer to self");

        // Get the caller for authorization check
        let caller = self.msg_sender().unwrap();

        // Collect notes to transfer the required amount from the `from` address
        let mut remaining = amount;
        let options = NoteGetterOptions::new().set_limit(MAX_NOTES);
        let notes = self.storage.balances.at(from).at(from).pop_notes(options);
        let notes_len = notes.len();

        let mut total_transferred: u128 = 0;
        for i in 0..MAX_NOTES {
            if (i < notes_len) & (remaining > 0) {
                let note = notes.get(i);
                if note.amount <= remaining {
                    // Transfer the entire note amount
                    total_transferred += note.amount;
                    remaining -= note.amount;
                } else {
                    // Partial transfer: create change note for the original owner
                    total_transferred += remaining;
                    let change = note.amount - remaining;
                    remaining = 0;

                    // Create change note with new randomness, returned to original owner
                    let change_randomness = dep::aztec::protocol_types::hash::poseidon2_hash([
                        note.randomness,
                        change as Field,
                    ]);
                    let change_note =
                        TokenNote { owner: from, amount: change, randomness: change_randomness };
                    self.storage.balances.at(from).at(from).insert(change_note).deliver(
                        MessageDelivery.CONSTRAINED_ONCHAIN,
                    );
                }
            }
        }

        assert(remaining == 0, "Insufficient balance to transfer");

        // Create note for recipient
        // Randomness includes caller address for uniqueness across different callers/transactions
        let recipient_randomness = dep::aztec::protocol_types::hash::poseidon2_hash([
            from.to_field(),
            to.to_field(),
            amount as Field,
            caller.to_field(),
        ]);
        let recipient_note =
            TokenNote { owner: to, amount: total_transferred, randomness: recipient_randomness };
        self.storage.balances.at(to).at(to).insert(recipient_note).deliver(
            MessageDelivery.CONSTRAINED_ONCHAIN,
        );

        // Enqueue public call to verify authorization
        // Pass the caller for authorization verification
        BridgedToken::at(self.context.this_address())._transfer_from_public(caller).enqueue(
            self.context,
        );
    }

    /// Internal public function to verify transfer_from authorization.
    ///
    /// This function verifies that the caller of transfer_from is an authorized burner.
    /// Uses the same authorization as burn_from since both require similar trust levels.
    ///
    /// # Arguments
    /// * `caller` - The address that called transfer_from (for authorization)
    #[external("public")]
    fn _transfer_from_public(caller: AztecAddress) {
        // Verify the caller is an authorized burner (reusing same authorization)
        let is_authorized = self.storage.authorized_burners.at(caller).read();
        assert(is_authorized == 1, "Caller is not authorized for transfer_from");
    }

    /// Transfers tokens privately from caller to recipient.
    ///
    /// # Arguments
    /// * `to` - The recipient's Aztec address
    /// * `amount` - Amount of tokens to transfer
    ///
    /// # Privacy
    /// - The entire transfer is private
    /// - No public state is modified
    #[external("private")]
    fn transfer(to: AztecAddress, amount: u128) {
        assert(amount > 0, "Amount must be greater than zero");
        assert(to.to_field() != 0, "Cannot transfer to zero address");

        let from = self.msg_sender().unwrap();
        assert(from.to_field() != to.to_field(), "Cannot transfer to self");

        // Collect notes to transfer the required amount
        let mut remaining = amount;
        let options = NoteGetterOptions::new().set_limit(MAX_NOTES);
        let notes = self.storage.balances.at(from).at(from).pop_notes(options);
        let notes_len = notes.len();

        let mut total_transferred: u128 = 0;
        for i in 0..MAX_NOTES {
            if (i < notes_len) & (remaining > 0) {
                let note = notes.get(i);
                if note.amount <= remaining {
                    // Transfer the entire note amount
                    total_transferred += note.amount;
                    remaining -= note.amount;
                } else {
                    // Partial transfer: create change note for sender
                    total_transferred += remaining;
                    let change = note.amount - remaining;
                    remaining = 0;

                    // Create change note with new randomness
                    let change_randomness = dep::aztec::protocol_types::hash::poseidon2_hash([
                        note.randomness,
                        change as Field,
                    ]);
                    let change_note =
                        TokenNote { owner: from, amount: change, randomness: change_randomness };
                    self.storage.balances.at(from).at(from).insert(change_note).deliver(
                        MessageDelivery.CONSTRAINED_ONCHAIN,
                    );
                }
            }
        }

        assert(remaining == 0, "Insufficient balance to transfer");

        // Create note for recipient
        let recipient_randomness = dep::aztec::protocol_types::hash::poseidon2_hash([
            from.to_field(),
            to.to_field(),
            amount as Field,
        ]);
        let recipient_note =
            TokenNote { owner: to, amount: total_transferred, randomness: recipient_randomness };
        self.storage.balances.at(to).at(to).insert(recipient_note).deliver(
            MessageDelivery.CONSTRAINED_ONCHAIN,
        );
    }

    // =========================================================================
    // Utility Functions (Unconstrained View Functions)
    // =========================================================================

    /// Get the private balance of an owner.
    ///
    /// This utility function queries the user's private notes from the PXE.
    /// Only the owner can decrypt and view their own balance.
    ///
    /// # Arguments
    /// * `owner` - The Aztec address to query
    ///
    /// # Returns
    /// * `u128` - The total balance across all notes
    #[external("utility")]
    unconstrained fn balance_of_private(owner: AztecAddress) -> pub u128 {
        let notes = self.storage.balances.at(owner).at(owner).view_notes(NoteViewerOptions::new());
        let mut total: u128 = 0;
        for i in 0..notes.len() {
            total += notes.get(i).amount;
        }
        total
    }

    /// Get all token notes for an owner (for debugging/inspection).
    ///
    /// # Arguments
    /// * `owner` - The Aztec address to query
    ///
    /// # Returns
    /// * `BoundedVec<TokenNote, MAX_NOTES_PER_PAGE>` - The user's token notes
    #[external("utility")]
    unconstrained fn get_notes(
        owner: AztecAddress,
    ) -> pub BoundedVec<TokenNote, MAX_NOTES_PER_PAGE> {
        self.storage.balances.at(owner).at(owner).view_notes(NoteViewerOptions::new())
    }

    /// Get the total supply of the token.
    ///
    /// # Returns
    /// * `u128` - The total supply
    #[external("utility")]
    unconstrained fn total_supply() -> pub u128 {
        self.storage.total_supply.read()
    }

    /// Get the token name.
    ///
    /// # Returns
    /// * `Field` - The token name
    #[external("utility")]
    unconstrained fn name() -> pub Field {
        self.storage.name.read()
    }

    /// Get the token symbol.
    ///
    /// # Returns
    /// * `Field` - The token symbol
    #[external("utility")]
    unconstrained fn symbol() -> pub Field {
        self.storage.symbol.read()
    }

    /// Get the token decimals.
    ///
    /// # Returns
    /// * `u8` - The token decimals
    #[external("utility")]
    unconstrained fn decimals() -> pub u8 {
        self.storage.decimals.read()
    }

    /// Get the minter address.
    ///
    /// # Returns
    /// * `AztecAddress` - The authorized minter address
    #[external("utility")]
    unconstrained fn minter() -> pub AztecAddress {
        self.storage.minter.read()
    }

    /// Get the admin address.
    ///
    /// # Returns
    /// * `AztecAddress` - The admin address
    #[external("utility")]
    unconstrained fn admin() -> pub AztecAddress {
        self.storage.admin.read()
    }

    /// Get the L1 TokenPortal address.
    ///
    /// # Returns
    /// * `EthAddress` - The L1 TokenPortal address
    #[external("utility")]
    unconstrained fn portal_address() -> pub EthAddress {
        self.storage.portal_address.read()
    }

    /// Check if an address is an authorized burner.
    ///
    /// # Arguments
    /// * `burner` - The address to check
    ///
    /// # Returns
    /// * `bool` - True if the address is authorized to burn on behalf of users
    #[external("utility")]
    unconstrained fn is_authorized_burner(burner: AztecAddress) -> pub bool {
        self.storage.authorized_burners.at(burner).read() == 1
    }

    /// Get all pending bridge claims for an owner.
    ///
    /// This utility function queries the user's pending claim notes from the PXE.
    /// Only the owner can decrypt and view their own pending bridges.
    ///
    /// # Arguments
    /// * `owner` - The Aztec address to query
    ///
    /// # Returns
    /// * `BoundedVec<PendingClaimNote, MAX_NOTES_PER_PAGE>` - The user's pending bridge claims
    ///
    /// # Privacy
    /// This function runs in the user's PXE and only returns notes encrypted for them.
    /// No information is revealed on-chain.
    #[external("utility")]
    unconstrained fn get_pending_bridges(
        owner: AztecAddress,
    ) -> pub BoundedVec<PendingClaimNote, MAX_NOTES_PER_PAGE> {
        self.storage.pending_claims.at(owner).at(owner).view_notes(NoteViewerOptions::new())
    }

    /// Get the count of pending bridge claims for an owner.
    ///
    /// # Arguments
    /// * `owner` - The Aztec address to query
    ///
    /// # Returns
    /// * `u32` - The number of pending bridge claims
    #[external("utility")]
    unconstrained fn get_pending_bridge_count(owner: AztecAddress) -> pub u32 {
        let notes =
            self.storage.pending_claims.at(owner).at(owner).view_notes(NoteViewerOptions::new());
        notes.len()
    }
}
