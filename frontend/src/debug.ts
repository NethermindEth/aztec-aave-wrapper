/**
 * Debug Utilities for Browser Console
 *
 * These utilities are exposed on `window.aztecDebug` for troubleshooting
 * stuck deposits and other issues from the browser console.
 *
 * Usage:
 *   await aztecDebug.queryIntent("0x123...")
 *   await aztecDebug.cancelDeposit("0x123...", netAmount)
 */

import { createL1PublicClient } from "./services/l1/client";
import { loadContractWithAzguard } from "./services/l2/contract";
import { getSponsoredFeePaymentMethod } from "./services/l2/operations";
import {
  L2PositionStatus,
  type PendingDepositInfo,
  queryPendingDeposit,
} from "./services/l2/positions";
import { connectAztecWallet } from "./services/wallet/aztec";
import { formatUSDC } from "./types/state";

/**
 * Get deployment addresses from localStorage or state
 */
function getDeploymentAddresses(): { l2Wrapper?: string } | null {
  try {
    const stored = localStorage.getItem("aztec-aave-deployments");
    if (stored) {
      const parsed = JSON.parse(stored);
      return { l2Wrapper: parsed.l2?.aaveWrapper };
    }
  } catch {
    // Fall back to checking window state
  }
  return null;
}

/**
 * Query a pending deposit intent from L2 public storage.
 * Use this to find stuck deposits where finalize_deposit failed.
 *
 * @param intentId - The intent ID to query (hex string starting with 0x)
 * @returns Information about the pending deposit
 *
 * @example
 * ```js
 * // In browser console:
 * await aztecDebug.queryIntent("0x123...")
 * ```
 */
export async function queryIntent(intentId: string): Promise<PendingDepositInfo | null> {
  console.log("Querying intent:", intentId);

  // Get deployment addresses
  const deployments = getDeploymentAddresses();
  if (!deployments?.l2Wrapper) {
    console.error("Deployment addresses not found. Make sure contracts are deployed.");
    return null;
  }

  try {
    // Connect to wallet and load contract
    const { wallet } = await connectAztecWallet();
    const { contract } = await loadContractWithAzguard(wallet, deployments.l2Wrapper);

    // Get current L1 timestamp
    const publicClient = createL1PublicClient();
    const block = await publicClient.getBlock();
    const currentTimestamp = block.timestamp;

    // Query intent
    const info = await queryPendingDeposit(contract, intentId, currentTimestamp);

    if (info) {
      console.log("=== Pending Deposit Info ===");
      console.log("Intent ID:", info.intentId);
      console.log(
        "Status:",
        info.status,
        `(${info.status === L2PositionStatus.PendingDeposit ? "PENDING_DEPOSIT" : info.status === L2PositionStatus.Active ? "ACTIVE" : "OTHER"})`
      );
      console.log("Deadline:", new Date(Number(info.deadline) * 1000).toISOString());
      console.log("Net Amount:", formatUSDC(info.netAmount), "USDC");
      console.log("Owner:", info.owner);
      console.log("Is Consumed:", info.isConsumed);
      console.log("Can Cancel:", info.canCancel);
      if (info.timeUntilCancellable > 0) {
        console.log("Time until cancellable:", info.timeUntilCancellable, "seconds");
      } else {
        console.log("Cancellable since:", -info.timeUntilCancellable, "seconds ago");
      }
      console.log("============================");

      if (info.canCancel) {
        console.log("\nYou can cancel this deposit to get your tokens back!");
        console.log(`Run: await aztecDebug.cancelDeposit("${intentId}", ${info.netAmount}n)`);
      }
    } else {
      console.log("Intent not found or has no data in public storage.");
    }

    return info;
  } catch (error) {
    console.error("Failed to query intent:", error);
    return null;
  }
}

/**
 * Cancel a pending deposit and recover tokens.
 * Only works if deadline has passed and deposit wasn't finalized.
 *
 * @param intentId - The intent ID to cancel (hex string)
 * @param netAmount - The net amount to refund (as bigint)
 *
 * @example
 * ```js
 * // In browser console:
 * await aztecDebug.cancelDeposit("0x123...", 990000n)
 * ```
 */
export async function cancelDeposit(intentId: string, netAmount: bigint): Promise<string | null> {
  console.log("Cancelling deposit:", intentId);
  console.log("Net amount:", formatUSDC(netAmount), "USDC");

  // Get deployment addresses
  const deployments = getDeploymentAddresses();
  if (!deployments?.l2Wrapper) {
    console.error("Deployment addresses not found. Make sure contracts are deployed.");
    return null;
  }

  try {
    // Connect to wallet and load contract
    const { wallet, address: walletAddress } = await connectAztecWallet();
    const { contract } = await loadContractWithAzguard(wallet, deployments.l2Wrapper);

    // Get current L1 timestamp
    const publicClient = createL1PublicClient();
    const block = await publicClient.getBlock();
    const currentTime = block.timestamp;

    console.log("Current L1 time:", currentTime);
    console.log("Calling cancel_deposit...");

    // Import Fr for intentId conversion
    const { Fr } = await import("@aztec/aztec.js/fields");
    const intentIdFr = Fr.fromString(intentId);

    // Get the sponsored fee payment method
    const paymentMethod = await getSponsoredFeePaymentMethod();

    // Get wallet address as AztecAddress
    const { AztecAddress } = await import("@aztec/aztec.js/addresses");
    const aztecAddress = AztecAddress.fromString(walletAddress);

    // Call cancel_deposit
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = contract.methods as any;
    const call = methods.cancel_deposit(intentIdFr, currentTime, netAmount);

    const tx = await call.send({ from: aztecAddress, fee: { paymentMethod } }).wait();

    const txHash = tx.txHash?.toString() ?? "";
    console.log("=== Cancel Deposit Success ===");
    console.log("TX Hash:", txHash);
    console.log("Refunded:", formatUSDC(netAmount), "USDC");
    console.log("==============================");

    return txHash;
  } catch (error) {
    console.error("Failed to cancel deposit:", error);
    return null;
  }
}

/**
 * Complete a pending deposit manually by providing the secret.
 * Use this if you saved your secret but finalize_deposit failed.
 *
 * @param intentId - The intent ID (hex string)
 * @param secretHex - The secret value (hex string from Fr.toString())
 *
 * @example
 * ```js
 * // In browser console:
 * await aztecDebug.completeDeposit("0x123...", "0xabc...")
 * ```
 */
export async function completeDeposit(intentId: string, secretHex: string): Promise<string | null> {
  console.log("Completing deposit:", intentId);

  // Get deployment addresses
  const deployments = getDeploymentAddresses();
  if (!deployments?.l2Wrapper) {
    console.error("Deployment addresses not found. Make sure contracts are deployed.");
    return null;
  }

  try {
    // Connect to wallet and load contract
    const { wallet, address: walletAddress } = await connectAztecWallet();
    const { contract } = await loadContractWithAzguard(wallet, deployments.l2Wrapper);

    // Get L1 public client and portal address
    const publicClient = createL1PublicClient();

    // Try to get portal address from localStorage
    let portalAddress: string | null = null;
    let mockUsdcAddress: string | null = null;
    try {
      const stored = localStorage.getItem("aztec-aave-deployments");
      if (stored) {
        const parsed = JSON.parse(stored);
        portalAddress = parsed.l1?.portal;
        mockUsdcAddress = parsed.l1?.mockUsdc;
      }
    } catch {
      console.error("Could not read deployment addresses");
      return null;
    }

    if (!portalAddress || !mockUsdcAddress) {
      console.error("Portal or USDC address not found in deployments");
      return null;
    }

    // Get shares from L1 portal
    const { getIntentShares } = await import("./services/l1/portal");
    const shares = await getIntentShares(
      publicClient,
      portalAddress as `0x${string}`,
      intentId as `0x${string}`
    );

    if (shares === 0n) {
      console.error("No shares recorded on L1 for this intent");
      return null;
    }

    console.log("Shares from L1:", shares.toString());

    // Import types
    const { Fr } = await import("@aztec/aztec.js/fields");
    const { AztecAddress } = await import("@aztec/aztec.js/addresses");

    const intentIdFr = Fr.fromString(intentId);
    const secretFr = Fr.fromString(secretHex);
    const assetId = BigInt(mockUsdcAddress);

    console.log("Calling finalize_deposit...");
    console.log("  intentId:", intentId);
    console.log("  assetId:", assetId.toString());
    console.log("  shares:", shares.toString());

    // Call finalize_deposit
    const { executeFinalizeDeposit } = await import("./services/l2/operations");
    const result = await executeFinalizeDeposit(
      contract,
      {
        intentId: intentIdFr,
        assetId,
        shares,
        secret: secretFr,
        messageLeafIndex: 0n,
      },
      AztecAddress.fromString(walletAddress)
    );

    console.log("=== Complete Deposit Success ===");
    console.log("TX Hash:", result.txHash);
    console.log("Shares:", formatUSDC(shares), "USDC");
    console.log("================================");

    return result.txHash;
  } catch (error) {
    console.error("Failed to complete deposit:", error);
    return null;
  }
}

/**
 * Debug utilities exposed on window.aztecDebug
 */
export const aztecDebug = {
  queryIntent,
  cancelDeposit,
  completeDeposit,
};

// Expose on window for browser console access
if (typeof window !== "undefined") {
  (window as any).aztecDebug = aztecDebug;
}
