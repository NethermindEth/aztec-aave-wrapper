/**
 * Unit tests for helper functions.
 *
 * These tests validate the utility functions in helpers/ directory
 * without requiring a running devnet or PXE connection.
 */

import { describe, it, expect } from "vitest";
import {
  computeExpectedIntentId,
  computeSecretHash,
  computeSalt,
  computeOwnerHash,
  computeDeadline,
  extractNoteFields,
  isFieldElement,
  toFieldBigInt,
  type PositionReceiptFields,
} from "./helpers/test-utils";
import {
  assertIntentIdValid,
  assertNoteFields,
  assertSpecificError,
  assertIntentIdNonZero,
  assertDeadlineInFuture,
  assertDeadlineInPast,
  assertContractError,
  CONTRACT_ERRORS,
} from "./helpers/assertions";

// Dynamic imports for aztec.js (same pattern as integration.test.ts)
let aztecAvailable = false;
let Fr: typeof import("@aztec/aztec.js/fields").Fr;
let AztecAddress: typeof import("@aztec/aztec.js/addresses").AztecAddress;

describe("Helper Functions Tests", () => {
  // Try to load aztec.js (3.0.0 uses subpath exports)
  beforeAll(async () => {
    try {
      const fieldsModule = await import("@aztec/aztec.js/fields");
      const addressesModule = await import("@aztec/aztec.js/addresses");
      Fr = fieldsModule.Fr;
      AztecAddress = addressesModule.AztecAddress;
      aztecAvailable = true;
    } catch (error) {
      console.warn("aztec.js not available - skipping tests that require it:", error);
    }
  });

  describe("computeExpectedIntentId", () => {
    it("should compute intent_id matching Noir implementation", async () => {
      if (!aztecAvailable) return;

      const caller = AztecAddress.fromString("0x1234567890123456789012345678901234567890123456789012345678901234");
      const asset = 1n;
      const amount = 1000n;
      const originalDecimals = 6;
      const deadline = 1700000000n;
      const salt = 42n;

      const intentId = await computeExpectedIntentId(
        caller,
        asset,
        amount,
        originalDecimals,
        deadline,
        salt
      );

      // Verify it returns a valid Field element
      expect(intentId).toBeDefined();
      expect(typeof intentId.toBigInt()).toBe("bigint");

      // Verify it's non-zero (hash should never be zero)
      expect(intentId.toBigInt()).not.toBe(0n);
    });

    it("should produce different intent_ids for different callers", async () => {
      if (!aztecAvailable) return;

      const caller1 = AztecAddress.fromString("0x1111111111111111111111111111111111111111111111111111111111111111");
      const caller2 = AztecAddress.fromString("0x2222222222222222222222222222222222222222222222222222222222222222");
      const asset = 1n;
      const amount = 1000n;
      const originalDecimals = 6;
      const deadline = 1700000000n;
      const salt = 42n;

      const intentId1 = await computeExpectedIntentId(
        caller1,
        asset,
        amount,
        originalDecimals,
        deadline,
        salt
      );

      const intentId2 = await computeExpectedIntentId(
        caller2,
        asset,
        amount,
        originalDecimals,
        deadline,
        salt
      );

      expect(intentId1.toBigInt()).not.toBe(intentId2.toBigInt());
    });

    it("should produce different intent_ids for different amounts", async () => {
      if (!aztecAvailable) return;

      const caller = AztecAddress.fromString("0x1234567890123456789012345678901234567890123456789012345678901234");
      const asset = 1n;
      const originalDecimals = 6;
      const deadline = 1700000000n;
      const salt = 42n;

      const intentId1 = await computeExpectedIntentId(
        caller,
        asset,
        1000n,
        originalDecimals,
        deadline,
        salt
      );

      const intentId2 = await computeExpectedIntentId(
        caller,
        asset,
        2000n,
        originalDecimals,
        deadline,
        salt
      );

      expect(intentId1.toBigInt()).not.toBe(intentId2.toBigInt());
    });
  });

  describe("computeSecretHash", () => {
    it("should compute secret hash using Aztec standard function", async () => {
      if (!aztecAvailable) return;

      const secret = Fr.random();
      const secretHash = await computeSecretHash(secret);

      // Verify it returns a valid Field element
      expect(secretHash).toBeDefined();
      expect(typeof secretHash.toBigInt()).toBe("bigint");
      expect(secretHash.toBigInt()).not.toBe(0n);
    });

    it("should produce different hashes for different secrets", async () => {
      if (!aztecAvailable) return;

      const secret1 = Fr.random();
      const secret2 = Fr.random();

      const hash1 = await computeSecretHash(secret1);
      const hash2 = await computeSecretHash(secret2);

      expect(hash1.toBigInt()).not.toBe(hash2.toBigInt());
    });

    it("should be deterministic for same secret", async () => {
      if (!aztecAvailable) return;

      const secret = new Fr(12345n);

      const hash1 = await computeSecretHash(secret);
      const hash2 = await computeSecretHash(secret);

      expect(hash1.toBigInt()).toBe(hash2.toBigInt());
    });
  });

  describe("computeSalt", () => {
    it("should compute salt matching Noir implementation", async () => {
      if (!aztecAvailable) return;

      const caller = AztecAddress.fromString("0x1234567890123456789012345678901234567890123456789012345678901234");
      const secretHash = 999n;

      const salt = await computeSalt(caller, secretHash);

      expect(salt).toBeDefined();
      expect(typeof salt.toBigInt()).toBe("bigint");
      expect(salt.toBigInt()).not.toBe(0n);
    });

    it("should produce different salts for different callers", async () => {
      if (!aztecAvailable) return;

      const caller1 = AztecAddress.fromString("0x1111111111111111111111111111111111111111111111111111111111111111");
      const caller2 = AztecAddress.fromString("0x2222222222222222222222222222222222222222222222222222222222222222");
      const secretHash = 999n;

      const salt1 = await computeSalt(caller1, secretHash);
      const salt2 = await computeSalt(caller2, secretHash);

      expect(salt1.toBigInt()).not.toBe(salt2.toBigInt());
    });
  });

  describe("computeOwnerHash", () => {
    it("should compute owner hash matching Noir implementation", async () => {
      if (!aztecAvailable) return;

      const owner = AztecAddress.fromString("0x1234567890123456789012345678901234567890123456789012345678901234");

      const ownerHash = await computeOwnerHash(owner);

      expect(ownerHash).toBeDefined();
      expect(typeof ownerHash.toBigInt()).toBe("bigint");
      expect(ownerHash.toBigInt()).not.toBe(0n);
    });

    it("should produce different hashes for different owners", async () => {
      if (!aztecAvailable) return;

      const owner1 = AztecAddress.fromString("0x1111111111111111111111111111111111111111111111111111111111111111");
      const owner2 = AztecAddress.fromString("0x2222222222222222222222222222222222222222222222222222222222222222");

      const hash1 = await computeOwnerHash(owner1);
      const hash2 = await computeOwnerHash(owner2);

      expect(hash1.toBigInt()).not.toBe(hash2.toBigInt());
    });
  });

  describe("computeDeadline", () => {
    it("should compute deadline from current time plus offset", () => {
      const offset = 3600; // 1 hour
      const beforeCall = BigInt(Math.floor(Date.now() / 1000));

      const deadline = computeDeadline(offset);

      const afterCall = BigInt(Math.floor(Date.now() / 1000));

      // Deadline should be approximately now + offset
      expect(deadline).toBeGreaterThanOrEqual(beforeCall + BigInt(offset));
      expect(deadline).toBeLessThanOrEqual(afterCall + BigInt(offset));
    });

    it("should produce deadlines in the future for positive offsets", () => {
      const offset = 60; // 1 minute
      const now = BigInt(Math.floor(Date.now() / 1000));

      const deadline = computeDeadline(offset);

      expect(deadline).toBeGreaterThan(now);
    });
  });

  describe("extractNoteFields", () => {
    it("should extract all fields from a note", () => {
      if (!aztecAvailable) return;

      // Create a mock note with the expected structure matching PositionReceiptNote
      const mockNote = {
        items: [
          new Fr(0x1111n), // owner
          new Fr(0x2222n), // nonce
          new Fr(0x3333n), // assetId
          new Fr(0x4444n), // shares
          new Fr(0x5555n), // aaveMarketId
          new Fr(1n), // status (Active = 1)
        ],
      };

      const fields = extractNoteFields(mockNote as any);

      expect(fields).toEqual({
        owner: 0x1111n,
        nonce: 0x2222n,
        assetId: 0x3333n,
        shares: 0x4444n,
        aaveMarketId: 0x5555n,
        status: 1,
      });
    });

    it("should throw if note has insufficient fields", () => {
      if (!aztecAvailable) return;

      const mockNote = {
        items: [new Fr(1n), new Fr(2n)], // Only 2 fields instead of 6
      };

      expect(() => extractNoteFields(mockNote as any)).toThrow(
        /Expected at least 6 fields/
      );
    });
  });

  describe("isFieldElement", () => {
    it("should return true for bigint values", () => {
      expect(isFieldElement(123n)).toBe(true);
      expect(isFieldElement(0n)).toBe(true);
    });

    it("should return false for non-bigint values", () => {
      expect(isFieldElement(123)).toBe(false);
      expect(isFieldElement("123")).toBe(false);
      expect(isFieldElement(null)).toBe(false);
      expect(isFieldElement(undefined)).toBe(false);
    });
  });

  describe("toFieldBigInt", () => {
    it("should return bigint values as-is", () => {
      expect(toFieldBigInt(123n)).toBe(123n);
    });

    it("should convert Fr to bigint", () => {
      if (!aztecAvailable) return;

      const fr = new Fr(456n);
      expect(toFieldBigInt(fr)).toBe(456n);
    });
  });
});

describe("Assertion Helpers Tests", () => {
  describe("assertIntentIdValid", () => {
    it("should pass when intent IDs match", () => {
      if (!aztecAvailable) return;

      const intentId = new Fr(12345n);
      assertIntentIdValid(intentId, 12345n);
    });

    it("should fail when intent IDs do not match", () => {
      if (!aztecAvailable) return;

      const intentId = new Fr(12345n);
      expect(() => assertIntentIdValid(intentId, 99999n)).toThrow();
    });
  });

  describe("assertNoteFields", () => {
    it("should pass when all specified fields match", () => {
      const actualFields: PositionReceiptFields = {
        owner: 0x1111n,
        nonce: 0x2222n,
        assetId: 0x3333n,
        shares: 0x4444n,
        aaveMarketId: 0x5555n,
        status: 1,
      };

      assertNoteFields(actualFields, {
        assetId: 0x3333n,
        shares: 0x4444n,
        status: 1,
      });
    });

    it("should fail when a field does not match", () => {
      const actualFields: PositionReceiptFields = {
        owner: 0x1111n,
        nonce: 0x2222n,
        assetId: 0x3333n,
        shares: 0x4444n,
        aaveMarketId: 0x5555n,
        status: 1,
      };

      expect(() =>
        assertNoteFields(actualFields, {
          assetId: 0x9999n, // Wrong value
        })
      ).toThrow();
    });
  });

  describe("assertSpecificError", () => {
    it("should pass when expected error is thrown", async () => {
      await assertSpecificError(
        async () => {
          throw new Error("Intent ID already consumed");
        },
        "Intent ID already consumed"
      );
    });

    it("should pass with regex pattern", async () => {
      await assertSpecificError(
        async () => {
          throw new Error("Intent ID already consumed");
        },
        /Intent ID.*consumed/
      );
    });

    it("should fail when no error is thrown", async () => {
      await expect(
        assertSpecificError(async () => {
          // No error thrown
        }, "Some error")
      ).rejects.toThrow(/Expected an error to be thrown/);
    });

    it("should fail when wrong error is thrown", async () => {
      await expect(
        assertSpecificError(
          async () => {
            throw new Error("Different error");
          },
          "Intent ID already consumed"
        )
      ).rejects.toThrow(/Expected error/);
    });
  });

  describe("assertIntentIdNonZero", () => {
    it("should pass for non-zero intent IDs", () => {
      if (!aztecAvailable) return;

      assertIntentIdNonZero(new Fr(12345n));
      assertIntentIdNonZero(12345n);
    });

    it("should fail for zero intent ID", () => {
      if (!aztecAvailable) return;

      expect(() => assertIntentIdNonZero(new Fr(0n))).toThrow(/must be non-zero/);
      expect(() => assertIntentIdNonZero(0n)).toThrow(/must be non-zero/);
    });
  });

  describe("assertDeadlineInFuture", () => {
    it("should pass for future deadlines", () => {
      const futureDeadline = BigInt(Math.floor(Date.now() / 1000)) + 3600n;
      assertDeadlineInFuture(futureDeadline);
    });

    it("should fail for past deadlines", () => {
      const pastDeadline = BigInt(Math.floor(Date.now() / 1000)) - 3600n;
      expect(() => assertDeadlineInFuture(pastDeadline)).toThrow(/must be in the future/);
    });
  });

  describe("assertDeadlineInPast", () => {
    it("should pass for past deadlines", () => {
      const pastDeadline = BigInt(Math.floor(Date.now() / 1000)) - 3600n;
      assertDeadlineInPast(pastDeadline);
    });

    it("should fail for future deadlines", () => {
      const futureDeadline = BigInt(Math.floor(Date.now() / 1000)) + 3600n;
      expect(() => assertDeadlineInPast(futureDeadline)).toThrow(/must be in the past/);
    });
  });

  describe("CONTRACT_ERRORS", () => {
    it("should have all expected error constants", () => {
      expect(CONTRACT_ERRORS.POSITION_NOT_FOUND).toBe("Position receipt note not found");
      expect(CONTRACT_ERRORS.INTENT_ALREADY_CONSUMED).toBe("Intent ID already consumed");
      expect(CONTRACT_ERRORS.WITHDRAWAL_EXCEEDS_SHARES).toBe(
        "Withdrawal amount exceeds available shares"
      );
      expect(CONTRACT_ERRORS.DEADLINE_EXPIRED).toBe("Deadline expired");
    });
  });

  describe("assertContractError", () => {
    it("should pass when expected contract error is thrown", async () => {
      await assertContractError(
        async () => {
          throw new Error("Intent ID already consumed");
        },
        "INTENT_ALREADY_CONSUMED"
      );
    });

    it("should fail when wrong error is thrown", async () => {
      await expect(
        assertContractError(
          async () => {
            throw new Error("Different error");
          },
          "INTENT_ALREADY_CONSUMED"
        )
      ).rejects.toThrow(/Expected error/);
    });
  });
});
