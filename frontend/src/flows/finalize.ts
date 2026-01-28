/**
 * Finalize Deposit Flow
 *
 * Completes a pending deposit by calling finalize_deposit on L2,
 * which consumes the L1→L2 confirmation message and creates
 * the encrypted PositionReceiptNote.
 */

import type { AztecAddress } from "@aztec/aztec.js/addresses";
import type { Chain, PublicClient, Transport } from "viem";
import { getIntentShares } from "../services/l1/portal.js";
import type { AaveWrapperContract } from "../services/l2/contract.js";
import { executeFinalizeDeposit } from "../services/l2/operations.js";
import { getSecret } from "../services/secrets.js";

/**
 * L2 context needed for finalization
 */
export interface FinalizeL2Context {
  /** AaveWrapper contract instance */
  contract: AaveWrapperContract;
  /** User's L2 wallet address */
  wallet: { address: AztecAddress };
}

/**
 * Parameters for finalize deposit flow
 */
export interface FinalizeDepositParams {
  /** The pending deposit's intent ID (hex string) */
  intentId: string;
  /** The user's L2 wallet address (for secret lookup) */
  walletAddress: string;
}

/**
 * Result of finalize deposit flow
 */
export interface FinalizeDepositResult {
  /** Transaction hash of the finalize_deposit call */
  txHash: string;
  /** Intent ID that was finalized */
  intentId: string;
  /** Number of shares in the created position */
  shares: bigint;
}

/**
 * Execute the finalize deposit flow.
 *
 * This completes a deposit that has been executed on L1 but not yet
 * finalized on L2. It:
 * 1. Retrieves the stored secret for the intent
 * 2. Fetches the shares recorded on L1 portal
 * 3. Calls finalize_deposit on L2 to create the PositionReceiptNote
 *
 * @param publicClient - L1 public client for reading portal state
 * @param portalAddress - L1 portal contract address
 * @param mockUsdcAddress - USDC token address (used as asset ID)
 * @param l2Context - L2 contract and wallet context
 * @param params - Intent ID and wallet address
 * @returns Finalize result with tx hash and shares
 * @throws If secret not found or L1 shares are 0
 */
export async function executeFinalizeDepositFlow(
  publicClient: PublicClient<Transport, Chain>,
  portalAddress: `0x${string}`,
  mockUsdcAddress: `0x${string}`,
  l2Context: FinalizeL2Context,
  params: FinalizeDepositParams
): Promise<FinalizeDepositResult> {
  const { intentId, walletAddress } = params;

  // Get stored secret
  const secretEntry = await getSecret(intentId, walletAddress);
  if (!secretEntry) {
    throw new Error(
      "Secret not found for this deposit. The secret was not stored during the original deposit flow. " +
        "Wait for the deadline to pass, then cancel to recover your tokens."
    );
  }

  // Get shares from L1 portal
  const shares = await getIntentShares(publicClient, portalAddress, intentId as `0x${string}`);

  if (shares === 0n) {
    throw new Error(
      "No shares recorded on L1 for this intent. L1 execution may not have completed yet."
    );
  }

  // Import Fr for field conversion
  const { Fr } = await import("@aztec/aztec.js/fields");

  const intentIdFr = Fr.fromString(intentId);
  const secretFr = Fr.fromString(secretEntry.secretHex);
  // Asset ID is the USDC address as a bigint (matches L1 encoding)
  const assetId = BigInt(mockUsdcAddress);

  // Call finalize_deposit
  const result = await executeFinalizeDeposit(
    l2Context.contract,
    {
      intentId: intentIdFr,
      assetId,
      shares,
      secret: secretFr,
      messageLeafIndex: 0n, // Will be resolved by the SDK
    },
    l2Context.wallet.address
  );

  return {
    txHash: result.txHash,
    intentId,
    shares,
  };
}
