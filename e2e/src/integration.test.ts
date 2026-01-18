/**
 * Integration tests for AaveWrapper L2 contract security assertions.
 *
 * These tests verify Priority 1: Critical Security assertions from TEST_AUDIT.md:
 * - Authorization: Users cannot access others' positions
 * - Replay Protection: Intents cannot be consumed multiple times
 * - Balance Validation: Withdrawals cannot exceed available shares
 *
 * Prerequisites:
 * - Local devnet running (docker compose up)
 * - Contract compiled (aztec compile in aztec/)
 * - Node.js v20 or v22 (v23+ has breaking changes with aztec.js import syntax)
 *
 * Run with: npm test -- integration.test.ts
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AaveWrapperContract,
  AaveWrapperContractArtifact,
} from "../../aztec/generated/AaveWrapper";

// Dynamic imports to handle Node.js v23+ compatibility issues with aztec.js
// The aztec packages use `import ... assert { type: 'json' }` which was
// deprecated in Node.js v23 in favor of `import ... with { type: 'json' }`
let aztecAvailable = false;
let createPXEClient: typeof import("@aztec/aztec.js/node").createAztecNodeClient;
let Fr: typeof import("@aztec/aztec.js/fields").Fr;
let AztecAddress: typeof import("@aztec/aztec.js/addresses").AztecAddress;
let EthAddress: typeof import("@aztec/foundation/eth-address").EthAddress;
let _GrumpkinScalar: typeof import("@aztec/aztec.js/fields").GrumpkinScalar;

type PXE = import("@aztec/stdlib/interfaces/client").AztecNode;

/**
 * Test configuration
 */
const TEST_CONFIG = {
  /** PXE URL for local devnet */
  pxeUrl: process.env.PXE_URL || "http://localhost:8080",
  /** Test amounts */
  depositAmount: 1000n,
  withdrawAmount: 500n,
  /** Original token decimals (e.g., USDC = 6) */
  originalDecimals: 6,
  /** Deadline offset (1 hour from now) */
  deadlineOffset: 60 * 60,
};

/**
 * Compute deadline from current time + offset
 */
function computeDeadline(offsetSeconds: number): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + offsetSeconds);
}

/**
 * Compute secret hash from a secret (async because SDK hash functions are async in 3.0.0)
 */
async function computeSecretHashFromFr(
  secret: InstanceType<typeof Fr>
): Promise<InstanceType<typeof Fr>> {
  const { computeSecretHash } = await import("@aztec/stdlib/hash");
  return computeSecretHash(secret);
}

describe("AaveWrapper Integration Tests - Priority 1: Critical Security", () => {
  let pxe: PXE | null = null;
  let pxeAvailable = false;

  // TestWallet instances - one per account for independent transactions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let adminWallet: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let userAWallet: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let userBWallet: any;

  // Account addresses (from createSchnorrAccount results)
  let adminAddress: InstanceType<typeof AztecAddress>;
  let userAAddress: InstanceType<typeof AztecAddress>;
  let userBAddress: InstanceType<typeof AztecAddress>;

  // Contract instance (deployed per test suite)
  let _aaveWrapper: AaveWrapperContract;
  let contractAddress: InstanceType<typeof AztecAddress>;

  // Portal address (mock for tests)
  let portalAddress: InstanceType<typeof EthAddress>;

  beforeAll(async () => {
    // Try to import aztec packages (3.0.0 uses subpath exports)
    try {
      const fieldsModule = await import("@aztec/aztec.js/fields");
      const addressesModule = await import("@aztec/aztec.js/addresses");
      const nodeModule = await import("@aztec/aztec.js/node");
      const ethAddressModule = await import("@aztec/foundation/eth-address");

      createPXEClient = nodeModule.createAztecNodeClient;
      Fr = fieldsModule.Fr;
      _GrumpkinScalar = fieldsModule.GrumpkinScalar;
      AztecAddress = addressesModule.AztecAddress;
      EthAddress = ethAddressModule.EthAddress;
      aztecAvailable = true;
    } catch (error) {
      const nodeVersion = process.version;
      console.warn(
        `aztec.js packages failed to load (Node.js ${nodeVersion}).\n` +
          `Error: ${error}\n` +
          `Skipping integration tests that require aztec.js.`
      );
      return;
    }

    // Set portal address
    portalAddress = EthAddress.fromString("0x1234567890123456789012345678901234567890");

    // Try to connect to PXE
    try {
      pxe = createPXEClient(TEST_CONFIG.pxeUrl);
      await pxe.getNodeInfo();
      pxeAvailable = true;
    } catch {
      console.warn(
        "PXE not available at",
        TEST_CONFIG.pxeUrl,
        "- skipping integration tests that require PXE"
      );
      return;
    }

    // Create TestWallets and register pre-funded sandbox accounts
    try {
      // Import the known test account keys from @aztec/accounts/testing
      const { INITIAL_TEST_SECRET_KEYS, INITIAL_TEST_SIGNING_KEYS, INITIAL_TEST_ACCOUNT_SALTS } =
        await import("@aztec/accounts/testing");
      const { TestWallet } = await import("@aztec/test-wallet/server");

      // Verify we have enough accounts
      if (
        INITIAL_TEST_SECRET_KEYS.length < 3 ||
        INITIAL_TEST_SIGNING_KEYS.length < 3 ||
        INITIAL_TEST_ACCOUNT_SALTS.length < 3
      ) {
        console.warn("Not enough pre-configured test accounts available");
        return;
      }

      // Create separate TestWallets for each account
      // Each TestWallet will have one account registered, allowing independent transactions
      adminWallet = await TestWallet.create(pxe!, { proverEnabled: false });
      userAWallet = await TestWallet.create(pxe!, { proverEnabled: false });
      userBWallet = await TestWallet.create(pxe!, { proverEnabled: false });

      // Create schnorr accounts in each wallet - returns account manager with address
      const adminAccountManager = await adminWallet.createSchnorrAccount(
        INITIAL_TEST_SECRET_KEYS[0]!,
        INITIAL_TEST_ACCOUNT_SALTS[0]!,
        INITIAL_TEST_SIGNING_KEYS[0]!
      );
      adminAddress = adminAccountManager.address;

      const userAAccountManager = await userAWallet.createSchnorrAccount(
        INITIAL_TEST_SECRET_KEYS[1]!,
        INITIAL_TEST_ACCOUNT_SALTS[1]!,
        INITIAL_TEST_SIGNING_KEYS[1]!
      );
      userAAddress = userAAccountManager.address;

      const userBAccountManager = await userBWallet.createSchnorrAccount(
        INITIAL_TEST_SECRET_KEYS[2]!,
        INITIAL_TEST_ACCOUNT_SALTS[2]!,
        INITIAL_TEST_SIGNING_KEYS[2]!
      );
      userBAddress = userBAccountManager.address;

      console.log("Using pre-funded sandbox accounts:");
      console.log("  Admin:", adminAddress.toString());
      console.log("  User A:", userAAddress.toString());
      console.log("  User B:", userBAddress.toString());
    } catch (error) {
      console.warn("Failed to setup accounts:", error);
      return;
    }
  });

  beforeEach(async () => {
    // Deploy fresh contract for each test to ensure isolation
    if (!aztecAvailable || !pxeAvailable || !adminWallet) return;

    // Use the generated AaveWrapperContract for type-safe deployment
    // Use adminWallet (TestWallet instance) for deployment
    // Use admin address as mock bridged token and fee treasury for testing
    const mockBridgedToken = adminAddress;
    const mockFeeTreasury = adminAddress;
    const deployedContract = await AaveWrapperContract.deploy(
      adminWallet,
      adminAddress,
      portalAddress,
      mockBridgedToken,
      mockFeeTreasury
    )
      .send({ from: adminAddress })
      .deployed();

    _aaveWrapper = deployedContract;
    contractAddress = deployedContract.address;

    // In 3.0.0 SDK, we need to register the deployed contract with other wallets
    // so they can interact with it. The adminWallet already has it registered from deployment.
    // We fetch the contract instance from the PXE and register it with other wallets.
    const contractInstance = await pxe!.getContract(contractAddress);
    if (contractInstance) {
      await userAWallet.registerContract(contractInstance, AaveWrapperContractArtifact);
      await userBWallet.registerContract(contractInstance, AaveWrapperContractArtifact);
    }

    console.log("Contract deployed at:", contractAddress.toString());
  });

  // ============================================================================
  // PRIORITY 1.1: Authorization Check Tests
  // ============================================================================

  describe("Authorization Checks", () => {
    it("should prevent user from withdrawing another user's position", async () => {
      if (!aztecAvailable || !pxeAvailable) {
        console.warn("Skipping test - aztec.js or PXE not available");
        return;
      }

      // User A creates a deposit
      const secretA = Fr.random();
      const secretHashA = await computeSecretHashFromFr(secretA);
      const deadline = computeDeadline(TEST_CONFIG.deadlineOffset);

      // Create contract instances bound to specific wallets
      // In 3.0.0 SDK, we use .at() with the wallet to bind the contract
      const userAContract = AaveWrapperContract.at(contractAddress, userAWallet);
      const userBContract = AaveWrapperContract.at(contractAddress, userBWallet);

      // User A requests deposit using typed methods
      // Signature: request_deposit(asset, amount, original_decimals, deadline, secret_hash)
      const depositCall = userAContract.methods.request_deposit(
        1n, // asset
        TEST_CONFIG.depositAmount, // amount
        TEST_CONFIG.originalDecimals, // original_decimals
        deadline, // deadline
        secretHashA // secret_hash
      );

      // Simulate first to get the return value (intent ID)
      const intentIdA = await depositCall.simulate({ from: userAAddress });

      // Assert: Intent ID should be a valid non-zero field element
      expect(intentIdA).toBeDefined();
      expect(intentIdA.toString()).not.toBe("0");

      // Send the transaction with the sender address
      await depositCall.send({ from: userAAddress }).wait();

      console.log("User A deposit intent ID:", intentIdA.toString());

      // User B attempts to withdraw from User A's position
      const secretB = Fr.random();
      const secretHashB = await computeSecretHashFromFr(secretB);

      // This should fail because User B doesn't have User A's position note.
      // Signature: request_withdraw(nonce, amount, deadline, secret_hash)
      // Note: The SDK may not extract the assert message, so we also accept app_logic_reverted
      await expect(
        userBContract.methods
          .request_withdraw(intentIdA, TEST_CONFIG.withdrawAmount, deadline, secretHashB)
          .send({ from: userBAddress })
          .wait()
      ).rejects.toThrow(/Position receipt note not found|app_logic_reverted/);
    });

    /**
     * NOTE: This test is marked as TODO because it requires L1 message injection.
     * The finalize_withdraw function requires an L1→L2 message to be present in the inbox.
     * Without L1 message mocking infrastructure, the call fails with "No L1 to L2 message found"
     * before the note authorization check can be triggered.
     *
     * When L1 message infrastructure is available, this test should:
     * 1. User A deposits and receives a PositionReceiptNote
     * 2. User A's position is finalized (receives L1 confirmation)
     * 3. User A requests withdrawal (status → PENDING_WITHDRAW)
     * 4. User B tries to finalize User A's withdrawal → should fail with "note not found"
     */
    it.todo("should prevent user from finalizing another user's withdrawal");
  });

  // ============================================================================
  // PRIORITY 1.2: Replay Protection Tests
  // ============================================================================

  describe("Replay Protection", () => {
    it("should prevent double finalization of deposit via _finalize_deposit_public", async () => {
      if (!aztecAvailable || !pxeAvailable) {
        console.warn("Skipping test - aztec.js or PXE not available");
        return;
      }

      const secret = Fr.random();
      const secretHash = await computeSecretHashFromFr(secret);
      const deadline = computeDeadline(TEST_CONFIG.deadlineOffset);

      // Create contract instances bound to specific wallets
      const userAContract = AaveWrapperContract.at(contractAddress, userAWallet);
      const adminContract = AaveWrapperContract.at(contractAddress, adminWallet);

      // Create deposit call
      const depositCall = userAContract.methods.request_deposit(
        1n, // asset
        TEST_CONFIG.depositAmount, // amount
        TEST_CONFIG.originalDecimals, // original_decimals
        deadline, // deadline
        secretHash // secret_hash
      );

      const intentId = await depositCall.simulate({ from: userAAddress });

      // Assert: Intent ID should be valid before sending
      expect(intentId).toBeDefined();
      expect(intentId.toString()).not.toBe("0");

      await depositCall.send({ from: userAAddress }).wait();

      // After request_deposit, intent status is PENDING_DEPOSIT
      // First call to _finalize_deposit_public should succeed and mark consumed
      await adminContract.methods
        ._finalize_deposit_public(intentId)
        .send({ from: adminAddress })
        .wait();

      // STATE CHANGE VERIFICATION:
      // After finalization, consumed_intents is set to true.
      // Second call to _finalize_deposit_public should fail with "Intent already consumed"
      // Note: The SDK may not extract the assert message, so we also accept app_logic_reverted
      await expect(
        adminContract.methods._finalize_deposit_public(intentId).send({ from: adminAddress }).wait()
      ).rejects.toThrow(/Intent already consumed|app_logic_reverted/);
    });

    it("should prevent re-setting intent as pending after finalization", async () => {
      if (!aztecAvailable || !pxeAvailable) {
        console.warn("Skipping test - aztec.js or PXE not available");
        return;
      }

      const secret = Fr.random();
      const secretHash = await computeSecretHashFromFr(secret);
      const deadline = computeDeadline(TEST_CONFIG.deadlineOffset);

      // Create contract instances bound to specific wallets
      const userAContract = AaveWrapperContract.at(contractAddress, userAWallet);
      const adminContract = AaveWrapperContract.at(contractAddress, adminWallet);

      // Create deposit call
      const depositCall = userAContract.methods.request_deposit(
        1n, // asset
        TEST_CONFIG.depositAmount, // amount
        TEST_CONFIG.originalDecimals, // original_decimals
        deadline, // deadline
        secretHash // secret_hash
      );

      const intentId = await depositCall.simulate({ from: userAAddress });
      await depositCall.send({ from: userAAddress }).wait();

      // Finalize the deposit (marks as consumed)
      await adminContract.methods
        ._finalize_deposit_public(intentId)
        .send({ from: adminAddress })
        .wait();

      // After finalization, trying to set intent as pending again should fail
      // because consumed_intents is now true
      // Note: The SDK may not extract the assert message, so we also accept app_logic_reverted
      await expect(
        adminContract.methods
          ._set_intent_pending_deposit(intentId, userAAddress)
          .send({ from: adminAddress })
          .wait()
      ).rejects.toThrow(/Intent ID already consumed|app_logic_reverted/);
    });

    it("should prevent finalizing non-pending deposit", async () => {
      if (!aztecAvailable || !pxeAvailable) {
        console.warn("Skipping test - aztec.js or PXE not available");
        return;
      }

      const fakeIntentId = Fr.random();

      // Create contract instance bound to admin wallet
      const adminContract = AaveWrapperContract.at(contractAddress, adminWallet);

      await expect(
        adminContract.methods
          ._finalize_deposit_public(fakeIntentId)
          .send({ from: adminAddress })
          .wait()
      ).rejects.toThrow(/Intent not in pending deposit state|app_logic_reverted/);
    });
  });

  // ============================================================================
  // PRIORITY 1.3: Balance Validation Tests
  // ============================================================================

  describe("Balance Validation", () => {
    /**
     * NOTE: This test is marked as TODO because it requires L1 message injection
     * to complete the full deposit→withdrawal flow. The assertion
     * "Withdrawal amount exceeds available shares" (main.nr:534) can only be
     * triggered after:
     * 1. request_deposit creates a pending intent
     * 2. L1 confirmation message is consumed to create a PositionReceiptNote
     * 3. request_withdraw is called with amount > shares
     *
     * Without L1 message mocking infrastructure, we can only verify the deposit
     * request succeeds, not the overflow protection.
     */
    it.todo("should prevent withdrawal exceeding available shares");

    /**
     * NOTE: This test is marked as TODO because it requires L1 message injection.
     * The assertion "Position is not active" (main.nr:531) can only be triggered
     * when:
     * 1. A deposit is fully finalized (requires L1 confirmation)
     * 2. First withdrawal request changes status to PENDING_WITHDRAW
     * 3. Second withdrawal request fails because status != ACTIVE
     *
     * Without L1 message mocking, we cannot create an ACTIVE PositionReceiptNote.
     */
    it.todo("should prevent double withdrawal request");

    it("should prevent finalizing non-pending withdrawal", async () => {
      if (!aztecAvailable || !pxeAvailable) {
        console.warn("Skipping test - aztec.js or PXE not available");
        return;
      }

      const fakeIntentId = Fr.random();

      // Create contract instance bound to userA wallet
      const userAContract = AaveWrapperContract.at(contractAddress, userAWallet);

      await expect(
        userAContract.methods
          ._finalize_withdraw_public(fakeIntentId)
          .send({ from: userAAddress })
          .wait()
      ).rejects.toThrow(/Intent not in pending withdraw state|app_logic_reverted/);
    });
  });

  // ============================================================================
  // Helper Tests - Verify Test Infrastructure
  // ============================================================================

  describe("Test Infrastructure", () => {
    it("should have valid contract artifact", () => {
      // Use the imported artifact from the generated code
      expect(AaveWrapperContractArtifact).toBeDefined();
      expect(AaveWrapperContractArtifact.name).toBe("AaveWrapper");
    });

    it("should create distinct accounts", async () => {
      if (!aztecAvailable || !pxeAvailable) {
        console.warn("Skipping test - aztec.js or PXE not available");
        return;
      }

      expect(adminAddress.equals(userAAddress)).toBe(false);
      expect(adminAddress.equals(userBAddress)).toBe(false);
      expect(userAAddress.equals(userBAddress)).toBe(false);
    });

    it("should deploy contract successfully", async () => {
      if (!aztecAvailable || !pxeAvailable) {
        console.warn("Skipping test - aztec.js or PXE not available");
        return;
      }

      expect(contractAddress).toBeDefined();
      expect(contractAddress.toString()).not.toBe(AztecAddress.ZERO.toString());
    });
  });
});
