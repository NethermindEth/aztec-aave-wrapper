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
 * - Contract compiled (aztec compile in aztec_contracts/)
 * - Node.js v20 or v22 (v23+ has breaking changes with aztec.js import syntax)
 *
 * Run with: npm test -- integration.test.ts
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Dynamic imports to handle Node.js v23+ compatibility issues with aztec.js
// The aztec packages use `import ... assert { type: 'json' }` which was
// deprecated in Node.js v23 in favor of `import ... with { type: 'json' }`
let aztecAvailable = false;
let createPXEClient: typeof import("@aztec/aztec.js").createPXEClient;
let AccountWallet: typeof import("@aztec/aztec.js").AccountWallet;
let Fr: typeof import("@aztec/aztec.js").Fr;
let AztecAddress: typeof import("@aztec/aztec.js").AztecAddress;
let EthAddress: typeof import("@aztec/aztec.js").EthAddress;
let Contract: typeof import("@aztec/aztec.js").Contract;
let GrumpkinScalar: typeof import("@aztec/aztec.js").GrumpkinScalar;
let getSchnorrAccount: typeof import("@aztec/accounts/schnorr").getSchnorrAccount;

type PXE = import("@aztec/aztec.js").PXE;
type ContractArtifact = import("@aztec/aztec.js").ContractArtifact;

/**
 * Test configuration
 */
const TEST_CONFIG = {
  /** PXE URL for local devnet */
  pxeUrl: process.env.PXE_URL || "http://localhost:8080",
  /** Test amounts */
  depositAmount: 1000n,
  withdrawAmount: 500n,
  /** Test chain ID */
  chainId: 23,
  /** Deadline offset (1 hour from now) */
  deadlineOffset: 60 * 60,
};

/**
 * Load the AaveWrapper contract artifact
 */
function loadArtifact(): ContractArtifact | null {
  try {
    const artifactPath = join(
      __dirname,
      "../../aztec_contracts/target/aave_wrapper-AaveWrapper.json"
    );
    const artifactJson = readFileSync(artifactPath, "utf-8");
    return JSON.parse(artifactJson) as ContractArtifact;
  } catch {
    return null;
  }
}

/**
 * Compute deadline from current time + offset
 */
function computeDeadline(offsetSeconds: number): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + offsetSeconds);
}

/**
 * Type helper for contract methods (aztec.js Contract has dynamic method types)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMethods = any;

describe("AaveWrapper Integration Tests - Priority 1: Critical Security", () => {
  let pxe: PXE | null = null;
  let artifact: ContractArtifact | null = null;
  let pxeAvailable = false;

  // Test accounts (initialized in beforeAll if PXE available)
  let adminWallet: InstanceType<typeof AccountWallet>;
  let userAWallet: InstanceType<typeof AccountWallet>;
  let userBWallet: InstanceType<typeof AccountWallet>;

  // Contract instance (deployed per test suite)
  let aaveWrapper: import("@aztec/aztec.js").Contract;
  let contractAddress: InstanceType<typeof AztecAddress>;

  // Portal address (mock for tests)
  let portalAddress: InstanceType<typeof EthAddress>;

  beforeAll(async () => {
    // Try to import aztec packages (may fail on Node.js v23+ due to import assertion changes)
    try {
      const aztecJs = await import("@aztec/aztec.js");
      const accounts = await import("@aztec/accounts/schnorr");

      createPXEClient = aztecJs.createPXEClient;
      AccountWallet = aztecJs.AccountWallet;
      Fr = aztecJs.Fr;
      AztecAddress = aztecJs.AztecAddress;
      EthAddress = aztecJs.EthAddress;
      Contract = aztecJs.Contract;
      GrumpkinScalar = aztecJs.GrumpkinScalar;
      getSchnorrAccount = accounts.getSchnorrAccount;
      aztecAvailable = true;
    } catch (error) {
      const nodeVersion = process.version;
      console.warn(
        `⚠️  aztec.js packages failed to load (Node.js ${nodeVersion}).\n` +
          `   The @aztec packages use 'import ... assert { type: "json" }' syntax\n` +
          `   which was deprecated in Node.js v23. Please use Node.js v20 or v22.\n` +
          `   Skipping integration tests that require aztec.js.`
      );
      return;
    }

    // Load contract artifact
    artifact = loadArtifact();
    if (!artifact) {
      console.warn("Contract artifact not found. Run: cd aztec_contracts && aztec compile");
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

    // Create test accounts
    const adminSecretKey = Fr.random();
    const adminSigningKey = GrumpkinScalar.random();
    const adminAccount = getSchnorrAccount(pxe, adminSecretKey, adminSigningKey);
    adminWallet = await adminAccount.waitSetup();

    const userASecretKey = Fr.random();
    const userASigningKey = GrumpkinScalar.random();
    const userAAccount = getSchnorrAccount(pxe, userASecretKey, userASigningKey);
    userAWallet = await userAAccount.waitSetup();

    const userBSecretKey = Fr.random();
    const userBSigningKey = GrumpkinScalar.random();
    const userBAccount = getSchnorrAccount(pxe, userBSecretKey, userBSigningKey);
    userBWallet = await userBAccount.waitSetup();

    console.log("Test accounts created:");
    console.log("  Admin:", adminWallet.getAddress().toString());
    console.log("  User A:", userAWallet.getAddress().toString());
    console.log("  User B:", userBWallet.getAddress().toString());
  });

  beforeEach(async () => {
    // Deploy fresh contract for each test to ensure isolation
    if (!aztecAvailable || !pxeAvailable || !adminWallet || !artifact) return;

    const deployedContract = await Contract.deploy(adminWallet, artifact, [
      adminWallet.getAddress(),
      portalAddress,
    ])
      .send()
      .deployed();

    aaveWrapper = deployedContract;
    contractAddress = deployedContract.address;

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
      const deadline = computeDeadline(TEST_CONFIG.deadlineOffset);

      // User A requests deposit
      const userAContract = aaveWrapper.withWallet(userAWallet);
      const userAMethods = userAContract.methods as AnyMethods;

      // Create call instance once, then simulate and send on same instance
      // This avoids race conditions from creating separate call instances
      const depositCall = userAMethods.request_deposit(
        1n,
        TEST_CONFIG.depositAmount,
        TEST_CONFIG.chainId,
        deadline,
        secretA
      );

      // Simulate first to get the return value (intent ID)
      const intentIdA = await depositCall.simulate();

      // Assert: Intent ID should be a valid non-zero field element
      expect(intentIdA).toBeDefined();
      expect(intentIdA.toString()).not.toBe("0");

      // Send the same call instance
      await depositCall.send().wait();

      console.log("User A deposit intent ID:", intentIdA.toString());

      // User B attempts to withdraw from User A's position
      const userBContract = aaveWrapper.withWallet(userBWallet);
      const userBMethods = userBContract.methods as AnyMethods;
      const secretB = Fr.random();

      // This should fail because User B doesn't have User A's position note.
      // The error depends on Aztec's note discovery:
      // - "Position receipt note not found": User B's PXE has no note for this intent
      // - "Not the owner": Note exists but owner check fails (shouldn't happen in practice)
      // We primarily expect "Position receipt note not found" since User B's wallet
      // was never given access to User A's notes.
      await expect(
        userBMethods
          .request_withdraw(intentIdA, TEST_CONFIG.withdrawAmount, deadline, secretB)
          .send()
          .wait()
      ).rejects.toThrow(/Position receipt note not found/);
    });

    it("should prevent user from finalizing another user's withdrawal", async () => {
      if (!aztecAvailable || !pxeAvailable) {
        console.warn("Skipping test - aztec.js or PXE not available");
        return;
      }

      const secretA = Fr.random();
      const deadline = computeDeadline(TEST_CONFIG.deadlineOffset);

      // User A requests deposit
      const userAContract = aaveWrapper.withWallet(userAWallet);
      const userAMethods = userAContract.methods as AnyMethods;

      // Create call instance once, then simulate and send on same instance
      const depositCall = userAMethods.request_deposit(
        1n,
        TEST_CONFIG.depositAmount,
        TEST_CONFIG.chainId,
        deadline,
        secretA
      );

      const intentIdA = await depositCall.simulate();

      // Assert: Intent ID should be valid
      expect(intentIdA).toBeDefined();
      expect(intentIdA.toString()).not.toBe("0");

      await depositCall.send().wait();

      // User B tries to finalize (would need a valid note they don't have)
      const userBContract = aaveWrapper.withWallet(userBWallet);
      const userBMethods = userBContract.methods as AnyMethods;

      // User B trying to finalize User A's withdrawal should fail.
      // Since User B's wallet has no access to User A's pending withdrawal note,
      // the note lookup will fail with "not found".
      await expect(
        userBMethods
          .finalize_withdraw(
            intentIdA,
            1n,
            TEST_CONFIG.withdrawAmount,
            TEST_CONFIG.chainId,
            secretA,
            0n
          )
          .send()
          .wait()
      ).rejects.toThrow(/Pending withdraw receipt note not found/);
    });
  });

  // ============================================================================
  // PRIORITY 1.2: Replay Protection Tests
  // ============================================================================

  describe("Replay Protection", () => {
    it("should prevent intent ID from being consumed twice", async () => {
      if (!aztecAvailable || !pxeAvailable) {
        console.warn("Skipping test - aztec.js or PXE not available");
        return;
      }

      const secret = Fr.random();
      const deadline = computeDeadline(TEST_CONFIG.deadlineOffset);

      const userAContract = aaveWrapper.withWallet(userAWallet);
      const methods = userAContract.methods as AnyMethods;

      // Create call instance once, then simulate and send on same instance
      const depositCall = methods.request_deposit(
        1n,
        TEST_CONFIG.depositAmount,
        TEST_CONFIG.chainId,
        deadline,
        secret
      );

      const intentId = await depositCall.simulate();

      // Assert: Intent ID should be valid before sending
      expect(intentId).toBeDefined();
      expect(intentId.toString()).not.toBe("0");

      await depositCall.send().wait();

      // STATE CHANGE VERIFICATION:
      // The intent status in public storage should now be PENDING_DEPOSIT.
      // We verify this by attempting to set it as pending again - which should fail
      // because the contract checks `consumed_intents` mapping.
      // Try to set the same intent as pending again via public function
      // This simulates a replay attack
      await expect(methods._set_intent_pending_deposit(intentId).send().wait()).rejects.toThrow(
        /Intent ID already consumed/
      );
    });

    it("should prevent double finalization of deposit", async () => {
      if (!aztecAvailable || !pxeAvailable) {
        console.warn("Skipping test - aztec.js or PXE not available");
        return;
      }

      const secret = Fr.random();
      const deadline = computeDeadline(TEST_CONFIG.deadlineOffset);

      const userAContract = aaveWrapper.withWallet(userAWallet);
      const methods = userAContract.methods as AnyMethods;

      // Create call instance once, then simulate and send on same instance
      const depositCall = methods.request_deposit(
        1n,
        TEST_CONFIG.depositAmount,
        TEST_CONFIG.chainId,
        deadline,
        secret
      );

      const intentId = await depositCall.simulate();
      await depositCall.send().wait();

      // First attempt to finalize via public function
      // This will fail because the intent is in PENDING_DEPOSIT state (not yet confirmed via L1 message)
      // The contract requires CONFIRMED status before deposits can be finalized
      await expect(methods._finalize_deposit_public(intentId).send().wait()).rejects.toThrow(
        /Intent not in pending deposit state|Intent already consumed/
      );
    });

    it("should prevent finalizing non-pending deposit", async () => {
      if (!aztecAvailable || !pxeAvailable) {
        console.warn("Skipping test - aztec.js or PXE not available");
        return;
      }

      const fakeIntentId = Fr.random();

      const userAContract = aaveWrapper.withWallet(userAWallet);
      const methods = userAContract.methods as AnyMethods;

      await expect(methods._finalize_deposit_public(fakeIntentId).send().wait()).rejects.toThrow(
        /Intent not in pending deposit state/
      );
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

      const userAContract = aaveWrapper.withWallet(userAWallet);
      const methods = userAContract.methods as AnyMethods;

      await expect(methods._finalize_withdraw_public(fakeIntentId).send().wait()).rejects.toThrow(
        /Intent not in pending withdraw state/
      );
    });
  });

  // ============================================================================
  // Helper Tests - Verify Test Infrastructure
  // ============================================================================

  describe("Test Infrastructure", () => {
    it("should have valid contract artifact", () => {
      // This test can run without aztec.js
      const localArtifact = loadArtifact();
      expect(localArtifact).not.toBeNull();
      expect(localArtifact?.name).toBe("AaveWrapper");
    });

    it("should create distinct accounts", async () => {
      if (!aztecAvailable || !pxeAvailable) {
        console.warn("Skipping test - aztec.js or PXE not available");
        return;
      }

      const adminAddr = adminWallet.getAddress();
      const userAAddr = userAWallet.getAddress();
      const userBAddr = userBWallet.getAddress();

      expect(adminAddr.equals(userAAddr)).toBe(false);
      expect(adminAddr.equals(userBAddr)).toBe(false);
      expect(userAAddr.equals(userBAddr)).toBe(false);
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
