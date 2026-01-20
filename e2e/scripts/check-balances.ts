/**
 * Diagnostic script to check BridgedToken balances and state
 *
 * Usage: cd e2e && bun run scripts/check-balances.ts [wallet_address]
 */

import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";
import { TestWallet } from "@aztec/test-wallet/server";
import { getInitialTestAccountsData } from "@aztec/accounts/testing";
import { BridgedTokenContract } from "../src/generated/BridgedToken";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { readFileSync } from "fs";
import { join } from "path";

const PXE_URL = process.env.PXE_URL || "http://localhost:8080";

// Get wallet address from CLI args or use default
const TARGET_WALLET = process.argv[2] || "0x240b398965c86b47d59c1f42ca4dff87b5d1c857f15f9089b5c35ff02a1a2b1f";

async function main() {
  console.log("=".repeat(60));
  console.log("BridgedToken Balance Checker");
  console.log("=".repeat(60));
  console.log();

  // Load deployment addresses
  const deploymentsPath = join(__dirname, "../../.deployments.local.json");
  const deployments = JSON.parse(readFileSync(deploymentsPath, "utf-8"));

  console.log("Loaded addresses:");
  console.log(`  BridgedToken: ${deployments.l2.bridgedToken}`);
  console.log(`  Target wallet: ${TARGET_WALLET}`);
  console.log();

  // Connect to Aztec node
  console.log(`Connecting to Aztec node at ${PXE_URL}...`);
  const node = createAztecNodeClient(PXE_URL);
  await waitForNode(node);
  console.log("Connected to PXE\n");

  // Create wallet and account (TestWallet for reading data)
  console.log("Creating test wallet...");
  const wallet = await TestWallet.create(node);
  const [alice] = await getInitialTestAccountsData();
  const account = await wallet.createSchnorrAccount(alice.secret, alice.salt);
  console.log(`Using test account: ${account.address.toString().slice(0, 18)}...\n`);

  // Parse addresses
  const bridgedTokenAddress = AztecAddress.fromString(deployments.l2.bridgedToken);
  const targetWallet = AztecAddress.fromString(TARGET_WALLET);

  // Load BridgedToken contract
  const contract = BridgedTokenContract.at(bridgedTokenAddress, wallet);

  // Query public state
  console.log("=== PUBLIC STATE ===");

  try {
    const totalSupply = await contract.methods.total_supply().simulate();
    console.log(`Total Supply: ${totalSupply} (${Number(totalSupply) / 1_000_000} USDC)`);
  } catch (error) {
    console.log(`Total supply query failed: ${error}`);
  }

  try {
    const admin = await contract.methods.admin().simulate();
    console.log(`Admin: ${admin.toString()}`);
  } catch (error) {
    console.log(`Admin query failed: ${error}`);
  }

  try {
    const minter = await contract.methods.minter().simulate();
    console.log(`Minter: ${minter.toString()}`);
  } catch (error) {
    console.log(`Minter query failed: ${error}`);
  }

  try {
    const portalAddress = await contract.methods.portal_address().simulate();
    console.log(`Portal Address: ${portalAddress.toString()}`);
  } catch (error) {
    console.log(`Portal address query failed: ${error}`);
  }

  // Query private balance for test account (we can only query notes we have access to)
  console.log("\n=== PRIVATE BALANCES ===");
  console.log("NOTE: Private balances can only be queried by the note owner's wallet.");
  console.log("These queries will only work for accounts registered in this PXE.\n");

  // Try to query for test account
  try {
    console.log(`Balance for test account (${account.address.toString().slice(0, 18)}...):`);
    const balance = await contract.methods.balance_of_private(account.address).simulate();
    console.log(`  Balance: ${balance} (${Number(balance) / 1_000_000} USDC)`);
  } catch (error) {
    console.log(`  Query failed: ${error}`);
  }

  // Try to query for target wallet
  try {
    console.log(`\nBalance for target wallet (${TARGET_WALLET.slice(0, 18)}...):`);
    const balance = await contract.methods.balance_of_private(targetWallet).simulate();
    console.log(`  Balance: ${balance} (${Number(balance) / 1_000_000} USDC)`);
  } catch (error) {
    console.log(`  Query failed (expected if not in this PXE): ${error}`);
  }

  // Get notes for test account
  console.log("\n=== TOKEN NOTES ===");
  try {
    console.log(`Notes for test account...`);
    const notes = await contract.methods.get_notes(account.address).simulate();
    console.log(`Notes count: ${notes.len ?? 0}`);
    if (notes.len && notes.len > 0) {
      for (let i = 0; i < notes.len; i++) {
        const note = notes.storage[i];
        console.log(`  Note ${i}:`);
        console.log(`    Owner: ${note.owner.toString()}`);
        console.log(`    Amount: ${note.amount} (${Number(note.amount) / 1_000_000} USDC)`);
      }
    }
  } catch (error) {
    console.log(`  Notes query failed: ${error}`);
  }

  console.log("\n" + "=".repeat(60));

  // Summary analysis
  console.log("\n=== ANALYSIS ===");
  try {
    const totalSupply = await contract.methods.total_supply().simulate();
    if (Number(totalSupply) > 0) {
      console.log(`Tokens WERE minted (total supply: ${totalSupply})`);
      console.log("If user wallet shows 0 balance, possible causes:");
      console.log("  1. Tokens minted to a DIFFERENT address than expected");
      console.log("  2. Wallet PXE doesn't have the notes synced yet");
      console.log("  3. Wrong BridgedToken contract being queried");
    } else {
      console.log("Total supply is 0 - NO tokens were minted!");
      console.log("The claim transaction may have failed silently, or");
      console.log("you're querying the wrong contract.");
    }
  } catch (error) {
    console.log(`Could not determine state: ${error}`);
  }

  console.log("\n=== DEBUGGING STEPS ===");
  console.log("1. Check if total_supply > 0 (confirms mint happened)");
  console.log("2. The claim_private function mints to msg_sender()");
  console.log("3. Check the txHash in aztec-sandbox logs for actual recipient");
  console.log("4. Verify wallet is synced and registered in the correct PXE");

  console.log("\n" + "=".repeat(60));
  console.log("Done!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
