#!/usr/bin/env bun
/**
 * Show pre-funded test account addresses and keys
 *
 * These accounts are pre-funded with Fee Juice in the Aztec sandbox.
 * You can import one into Azguard wallet to get Fee Juice.
 *
 * Run: bun run scripts/show-test-accounts.ts
 */

async function main() {
  const { createAztecNodeClient, waitForNode } = await import("@aztec/aztec.js/node");
  const { TestWallet } = await import("@aztec/test-wallet/server");
  const {
    INITIAL_TEST_SECRET_KEYS,
    INITIAL_TEST_SIGNING_KEYS,
    INITIAL_TEST_ACCOUNT_SALTS,
  } = await import("@aztec/accounts/testing");

  const PXE_URL = process.env.PXE_URL || "http://localhost:8080";

  console.log("Connecting to Aztec node at", PXE_URL, "...");
  const node = createAztecNodeClient(PXE_URL);
  await waitForNode(node);
  console.log("Connected!\n");

  console.log("=".repeat(80));
  console.log("PRE-FUNDED SANDBOX TEST ACCOUNTS");
  console.log("=".repeat(80));
  console.log("\nThese accounts are pre-funded with Fee Juice in the Aztec sandbox.");
  console.log("You can import one of these into Azguard wallet.\n");

  for (let i = 0; i < 3; i++) {
    console.log(`\n--- Account ${i} ---`);

    // Create a wallet to get the address
    const wallet = await TestWallet.create(node, { proverEnabled: false });
    const accountManager = await wallet.createSchnorrAccount(
      INITIAL_TEST_SECRET_KEYS[i]!,
      INITIAL_TEST_ACCOUNT_SALTS[i]!,
      INITIAL_TEST_SIGNING_KEYS[i]!
    );

    console.log(`Address:     ${accountManager.address.toString()}`);
    console.log(`Secret Key:  ${INITIAL_TEST_SECRET_KEYS[i]!.toString()}`);
    console.log(`Signing Key: ${INITIAL_TEST_SIGNING_KEYS[i]!.toString()}`);
    console.log(`Salt:        ${INITIAL_TEST_ACCOUNT_SALTS[i]!.toString()}`);
  }

  console.log("\n" + "=".repeat(80));
  console.log("To use in Azguard: Import one of the Secret Keys above");
  console.log("=".repeat(80));
}

main().catch(console.error);

// Make this file a module to avoid "duplicate function" errors in TypeScript
export {};
