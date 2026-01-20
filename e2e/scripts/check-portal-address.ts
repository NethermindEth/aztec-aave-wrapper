/**
 * Diagnostic script to check:
 * 1. BridgedToken's portal_address matches TokenPortal address
 * 2. secretHash computation: poseidon2Hash vs computeSecretHash
 *
 * This helps debug the L1→L2 claim failure where consume_l1_to_l2_message
 * reports "nonexistent message".
 *
 * Usage: cd e2e && bun run scripts/check-portal-address.ts
 */

import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";
import { TestWallet } from "@aztec/test-wallet/server";
import { getInitialTestAccountsData } from "@aztec/accounts/testing";
import { BridgedTokenContract } from "../src/generated/BridgedToken";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";
import { computeSecretHash } from "@aztec/stdlib/hash";
import { poseidon2Hash } from "@aztec/foundation/crypto/poseidon";
import { readFileSync } from "fs";
import { join } from "path";

const PXE_URL = process.env.PXE_URL || "http://localhost:8080";

async function main() {
  console.log("=".repeat(70));
  console.log("DIAGNOSTIC: Checking BridgedToken portal_address");
  console.log("=".repeat(70));

  // Load deployment addresses
  const deploymentsPath = join(__dirname, "../../.deployments.local.json");
  const deployments = JSON.parse(readFileSync(deploymentsPath, "utf-8"));

  console.log("\n[1] Loaded deployment addresses:");
  console.log(`    L1 TokenPortal: ${deployments.l1.tokenPortal}`);
  console.log(`    L2 BridgedToken: ${deployments.l2.bridgedToken}`);

  // Connect to Aztec node
  console.log("\n[2] Connecting to Aztec node...");
  const node = createAztecNodeClient(PXE_URL);
  await waitForNode(node);
  console.log("    ✓ Connected to PXE");

  // Create wallet and account
  console.log("\n[3] Creating wallet...");
  const wallet = await TestWallet.create(node);
  const [alice] = await getInitialTestAccountsData();
  const account = await wallet.createSchnorrAccount(alice.secret, alice.salt);
  console.log(`    ✓ Wallet ready, account: ${account.address.toString().slice(0, 18)}...`);

  // Load BridgedToken contract
  console.log("\n[4] Loading BridgedToken contract...");
  const bridgedTokenAddress = AztecAddress.fromString(deployments.l2.bridgedToken);
  const contract = BridgedTokenContract.at(bridgedTokenAddress, wallet);
  console.log(`    ✓ Contract loaded at ${bridgedTokenAddress.toString()}`);

  // Query portal_address
  console.log("\n[5] Querying BridgedToken.portal_address()...");
  try {
    const portalAddress = await contract.methods.portal_address().simulate();
    const portalAddressStr = portalAddress?.toString?.() ?? String(portalAddress);
    console.log(`    Portal address stored in BridgedToken: ${portalAddressStr}`);

    // Compare with expected TokenPortal address
    const expectedPortal = deployments.l1.tokenPortal.toLowerCase();
    const actualPortalLower = portalAddressStr.toLowerCase();

    console.log("\n[6] Comparing addresses:");
    console.log(`    Expected (from deployments): ${expectedPortal}`);
    console.log(`    Actual (from contract):      ${actualPortalLower}`);

    // Check if they match (handling potential format differences)
    // EthAddress might be returned as just the 20-byte hex without 0x prefix
    // or with different zero padding
    const normalizedExpected = expectedPortal.replace("0x", "").toLowerCase();
    const normalizedActual = actualPortalLower.replace("0x", "").toLowerCase();

    // Also check if it's a field representation (40 hex chars for address)
    const expected20Bytes = normalizedExpected.slice(-40); // Last 40 chars (20 bytes)
    const actual20Bytes = normalizedActual.slice(-40);

    console.log(`    Normalized expected (last 20 bytes): ${expected20Bytes}`);
    console.log(`    Normalized actual (last 20 bytes):   ${actual20Bytes}`);

    if (expected20Bytes === actual20Bytes) {
      console.log("\n✅ MATCH: portal_address in BridgedToken matches TokenPortal address");
    } else {
      console.log("\n❌ MISMATCH: portal_address does NOT match!");
      console.log("   This is the likely cause of the claim failure.");
      console.log("   The L1→L2 message sender is TokenPortal, but BridgedToken expects a different address.");
    }
  } catch (error) {
    console.log(`    ✗ Failed to query portal_address: ${error instanceof Error ? error.message : error}`);
    if (error instanceof Error) {
      console.log("    Stack:", error.stack);
    }
  }

  // Also query admin, minter, etc. for additional context
  console.log("\n[7] Additional contract state:");
  try {
    const admin = await contract.methods.admin().simulate();
    console.log(`    Admin: ${admin?.toString?.() ?? admin}`);
  } catch (e) {
    console.log(`    Admin query failed: ${e instanceof Error ? e.message : e}`);
  }

  try {
    const minter = await contract.methods.minter().simulate();
    console.log(`    Minter: ${minter?.toString?.() ?? minter}`);
  } catch (e) {
    console.log(`    Minter query failed: ${e instanceof Error ? e.message : e}`);
  }

  try {
    const totalSupply = await contract.methods.total_supply().simulate();
    console.log(`    Total supply: ${totalSupply?.toString?.() ?? totalSupply}`);
  } catch (e) {
    console.log(`    Total supply query failed: ${e instanceof Error ? e.message : e}`);
  }

  // =========================================================================
  // Test 8: SecretHash Computation Difference
  // =========================================================================
  console.log("\n[8] Testing secretHash computation methods...");

  try {
    // Generate a random secret
    const testSecret = Fr.random();
    console.log(`    Test secret: ${testSecret.toString().slice(0, 30)}...`);

    // Method 1: Plain poseidon2Hash (what frontend uses)
    const secretHashPoseidon = await poseidon2Hash([testSecret.toBigInt()]);
    console.log(`    poseidon2Hash([secret]):    ${secretHashPoseidon.toString()}`);

    // Method 2: computeSecretHash (Aztec SDK function)
    const secretHashCompute = await computeSecretHash(testSecret);
    console.log(`    computeSecretHash(secret):  ${secretHashCompute.toString()}`);

    // Compare
    const poseidonBigInt = typeof secretHashPoseidon === 'bigint'
      ? secretHashPoseidon
      : secretHashPoseidon.toBigInt?.() ?? BigInt(secretHashPoseidon.toString());
    const computeBigInt = secretHashCompute.toBigInt();

    if (poseidonBigInt === computeBigInt) {
      console.log("\n✅ MATCH: Both methods produce the same secretHash");
      console.log("   This is NOT the cause of the claim failure.");
    } else {
      console.log("\n❌ MISMATCH: Different secretHash values!");
      console.log("   poseidon2Hash result: 0x" + poseidonBigInt.toString(16));
      console.log("   computeSecretHash result: 0x" + computeBigInt.toString(16));
      console.log("\n   🔴 THIS IS LIKELY THE BUG!");
      console.log("   The frontend uses poseidon2Hash([secret]) to compute secretHash,");
      console.log("   but Aztec's consume_l1_to_l2_message may use computeSecretHash internally.");
      console.log("   This would cause the message lookup to fail because the hashes don't match.");
      console.log("\n   FIX: Change frontend/src/services/l2/crypto.ts to use computeSecretHash");
      console.log("   instead of poseidon2Hash for secretHash computation.");
    }
  } catch (e) {
    console.log(`    ✗ SecretHash test failed: ${e instanceof Error ? e.message : e}`);
    if (e instanceof Error) {
      console.log("    Stack:", e.stack);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("Diagnostic complete");
  console.log("=".repeat(70));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
