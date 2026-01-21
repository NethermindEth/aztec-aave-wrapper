/**
 * Recover Deposit Component
 *
 * Allows users to query and cancel stuck pending deposits where
 * finalize_deposit failed but tokens were already burned.
 */

import { createSignal, For, Show, type JSX } from "solid-js";
import { createL1PublicClient } from "../services/l1/client";
import { getIntentShares } from "../services/l1/portal";
import { loadContractWithAzguard } from "../services/l2/contract";
import {
  type FoundIntent,
  L2PositionStatus,
  type PendingDepositInfo,
  queryPendingDeposit,
  scanUserIntentsFromL1,
} from "../services/l2/positions";
import { executeFinalizeDeposit, getSponsoredFeePaymentMethod } from "../services/l2/operations";
import { getSecret, hasSecret } from "../services/secrets";
import { connectAztecWallet } from "../services/wallet/aztec";
import { formatUSDC } from "../types/state";
import { useAppState } from "../store/hooks";

/**
 * Format timestamp to readable date
 */
function formatTimestamp(timestamp: bigint): string {
  if (timestamp === 0n) return "N/A";
  return new Date(Number(timestamp) * 1000).toLocaleString();
}

/**
 * Get status label from status code
 */
function getStatusLabel(status: number): string {
  switch (status) {
    case L2PositionStatus.PendingDeposit:
      return "Pending Deposit";
    case L2PositionStatus.Active:
      return "Active";
    case L2PositionStatus.PendingWithdraw:
      return "Pending Withdraw";
    default:
      return `Unknown (${status})`;
  }
}

/**
 * Chevron icon component
 */
function ChevronIcon(props: { expanded: boolean }): JSX.Element {
  return (
    <svg
      class={`w-4 h-4 transition-transform ${props.expanded ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

export function RecoverDeposit() {
  const state = useAppState();

  // Collapse state - collapsed by default
  const [isExpanded, setIsExpanded] = createSignal(false);

  // Input state
  const [intentId, setIntentId] = createSignal("");

  // Query state
  const [isQuerying, setIsQuerying] = createSignal(false);
  const [queryError, setQueryError] = createSignal<string | null>(null);
  const [depositInfo, setDepositInfo] = createSignal<PendingDepositInfo | null>(null);

  // Cancel state
  const [isCancelling, setIsCancelling] = createSignal(false);
  const [cancelError, setCancelError] = createSignal<string | null>(null);
  const [cancelSuccess, setCancelSuccess] = createSignal<string | null>(null);

  // Scan state
  const [isScanning, setIsScanning] = createSignal(false);
  const [scanError, setScanError] = createSignal<string | null>(null);
  const [foundIntents, setFoundIntents] = createSignal<FoundIntent[]>([]);

  // Complete deposit state
  const [isCompleting, setIsCompleting] = createSignal(false);
  const [completeError, setCompleteError] = createSignal<string | null>(null);
  const [completeSuccess, setCompleteSuccess] = createSignal<string | null>(null);
  const [secretExists, setSecretExists] = createSignal(false);

  /**
   * Query the intent status from L2 public storage
   */
  const handleQuery = async () => {
    const id = intentId().trim();
    if (!id) {
      setQueryError("Please enter an intent ID");
      return;
    }

    // Validate hex format
    if (!id.startsWith("0x")) {
      setQueryError("Intent ID must start with 0x");
      return;
    }

    // Check contracts are loaded
    if (!state.contracts.l2Wrapper) {
      setQueryError("Contracts not loaded. Please wait for deployment.");
      return;
    }

    setIsQuerying(true);
    setQueryError(null);
    setDepositInfo(null);
    setCancelSuccess(null);
    setCancelError(null);
    setCompleteSuccess(null);
    setCompleteError(null);
    setSecretExists(false);

    try {
      // Connect to wallet and load contract
      const { wallet } = await connectAztecWallet();
      const { contract } = await loadContractWithAzguard(wallet, state.contracts.l2Wrapper);

      // Get current L1 timestamp
      const publicClient = createL1PublicClient();
      const block = await publicClient.getBlock();
      const currentTimestamp = block.timestamp;

      // Query intent
      const info = await queryPendingDeposit(contract, id, currentTimestamp);

      if (info) {
        setDepositInfo(info);
        // Check if we have a stored secret for this intent
        const hasStoredSecret = hasSecret(id);
        setSecretExists(hasStoredSecret);
      } else {
        setQueryError("Intent not found or has no data in public storage.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setQueryError(`Failed to query: ${message}`);
    } finally {
      setIsQuerying(false);
    }
  };

  /**
   * Cancel the pending deposit and recover tokens
   */
  const handleCancel = async () => {
    const info = depositInfo();
    if (!info) return;

    if (!info.canCancel) {
      setCancelError("Cannot cancel: deadline has not passed yet");
      return;
    }

    if (!state.contracts.l2Wrapper) {
      setCancelError("Contracts not loaded");
      return;
    }

    setIsCancelling(true);
    setCancelError(null);
    setCancelSuccess(null);

    try {
      // Connect to wallet and load contract
      const { wallet, address: walletAddress } = await connectAztecWallet();
      const { contract } = await loadContractWithAzguard(wallet, state.contracts.l2Wrapper);

      // Get current L1 timestamp
      const publicClient = createL1PublicClient();
      const block = await publicClient.getBlock();
      const currentTime = block.timestamp;

      // Import required types
      const { Fr } = await import("@aztec/aztec.js/fields");
      const { AztecAddress } = await import("@aztec/aztec.js/addresses");

      const intentIdFr = Fr.fromString(info.intentId);
      const aztecAddress = AztecAddress.fromString(walletAddress);

      // Get the sponsored fee payment method
      const paymentMethod = await getSponsoredFeePaymentMethod();

      // Call cancel_deposit
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const methods = contract.methods as any;
      const call = methods.cancel_deposit(intentIdFr, currentTime, info.netAmount);

      const tx = await call.send({ from: aztecAddress, fee: { paymentMethod } }).wait();

      const txHash = tx.txHash?.toString() ?? "";
      setCancelSuccess(
        `Deposit cancelled! TX: ${txHash}. Refunded: ${formatUSDC(info.netAmount)} USDC`
      );
      setDepositInfo(null);
      setIntentId("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setCancelError(`Failed to cancel: ${message}`);
    } finally {
      setIsCancelling(false);
    }
  };

  /**
   * Complete a pending deposit by calling finalize_deposit
   */
  const handleCompleteDeposit = async () => {
    const info = depositInfo();
    if (!info) return;

    if (!secretExists()) {
      setCompleteError(
        "No secret found for this deposit. The secret was not stored during the original deposit flow. Unfortunately, this deposit cannot be completed. Wait for the deadline to pass, then cancel to recover your tokens."
      );
      return;
    }

    if (!state.contracts.l2Wrapper || !state.contracts.portal || !state.contracts.mockUsdc) {
      setCompleteError("Contracts not loaded");
      return;
    }

    setIsCompleting(true);
    setCompleteError(null);
    setCompleteSuccess(null);

    try {
      // Connect to wallet and load contract
      const { wallet, address: walletAddress } = await connectAztecWallet();
      const { contract } = await loadContractWithAzguard(wallet, state.contracts.l2Wrapper);

      // Get the stored secret
      const secretEntry = await getSecret(info.intentId, walletAddress);
      if (!secretEntry) {
        throw new Error("Secret not found or could not be decrypted");
      }

      // Get shares from L1 portal
      const publicClient = createL1PublicClient();
      const shares = await getIntentShares(
        publicClient,
        state.contracts.portal as `0x${string}`,
        info.intentId as `0x${string}`
      );

      if (shares === 0n) {
        throw new Error("No shares recorded on L1 for this intent. L1 execution may have failed.");
      }

      // Import required types
      const { Fr } = await import("@aztec/aztec.js/fields");
      const { AztecAddress } = await import("@aztec/aztec.js/addresses");

      const intentIdFr = Fr.fromString(info.intentId);
      const secretFr = Fr.fromString(secretEntry.secret);
      // Asset ID is the USDC address as a bigint (matches L1 encoding)
      const assetId = BigInt(state.contracts.mockUsdc);

      console.log("[handleCompleteDeposit] Calling finalize_deposit with:");
      console.log("  intentId:", info.intentId);
      console.log("  assetId:", assetId.toString());
      console.log("  shares:", shares.toString());
      console.log("  secret:", secretEntry.secret.slice(0, 20) + "...");

      // Call finalize_deposit
      // Note: messageLeafIndex is tricky - we try with 0 first, then scan if needed
      const result = await executeFinalizeDeposit(
        contract,
        {
          intentId: intentIdFr,
          assetId,
          shares,
          secret: secretFr,
          messageLeafIndex: 0n, // Will be resolved by the SDK
        },
        AztecAddress.fromString(walletAddress)
      );

      setCompleteSuccess(
        `Deposit completed! TX: ${result.txHash}. You now have ${formatUSDC(shares)} shares.`
      );
      setDepositInfo(null);
      setIntentId("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[handleCompleteDeposit] Error:", error);
      setCompleteError(`Failed to complete deposit: ${message}`);
    } finally {
      setIsCompleting(false);
    }
  };

  /**
   * Scan L1 events to find user's pending deposits
   */
  const handleScan = async () => {
    // Check contracts are loaded
    if (!state.contracts.l2Wrapper || !state.contracts.portal) {
      setScanError("Contracts not loaded. Please wait for deployment.");
      return;
    }

    setIsScanning(true);
    setScanError(null);
    setFoundIntents([]);

    try {
      // Connect to wallet and load contract
      const { wallet, address: walletAddress } = await connectAztecWallet();
      const { contract } = await loadContractWithAzguard(wallet, state.contracts.l2Wrapper);

      // Create L1 client
      const publicClient = createL1PublicClient();

      // Scan for intents
      const result = await scanUserIntentsFromL1(
        publicClient,
        state.contracts.portal as `0x${string}`,
        contract,
        walletAddress
      );

      if (result.success) {
        setFoundIntents(result.intents);
        if (result.intents.length === 0) {
          setScanError(
            `Scanned ${result.totalScanned} events but found no deposits belonging to your account.`
          );
        }
      } else {
        setScanError(result.error ?? "Scan failed");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setScanError(`Scan failed: ${message}`);
    } finally {
      setIsScanning(false);
    }
  };

  /**
   * Select a found intent to query its details
   */
  const selectIntent = (intent: FoundIntent) => {
    setIntentId(intent.intentId);
    setFoundIntents([]);
    // Automatically query the selected intent
    handleQuery();
  };

  return (
    <section class="bg-zinc-900 rounded-lg border border-zinc-800">
      {/* Collapsible Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded())}
        class="w-full flex items-center justify-between p-4 text-left hover:bg-zinc-800/50 transition-colors rounded-lg"
      >
        <div>
          <h2 class="text-lg font-medium text-zinc-100">Recover Stuck Deposit</h2>
          <p class="text-sm text-zinc-500">Query and cancel failed deposits to recover tokens</p>
        </div>
        <ChevronIcon expanded={isExpanded()} />
      </button>

      {/* Collapsible Content */}
      <Show when={isExpanded()}>
        <div class="px-4 pb-4 space-y-4 border-t border-zinc-800 pt-3">
          {/* Scan Section */}
          <div class="bg-zinc-800/50 rounded p-3 space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-sm font-medium text-zinc-200">Find My Deposits</h3>
                <p class="text-xs text-zinc-500">Scan L1 events to find your pending deposits</p>
              </div>
              <button
                onClick={handleScan}
                disabled={isScanning()}
                class="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium rounded transition-colors"
              >
                {isScanning() ? "Scanning..." : "Scan for Deposits"}
              </button>
            </div>

            {/* Scan Error */}
            <Show when={scanError()}>
              <div class="p-2 bg-yellow-900/20 border border-yellow-800 rounded text-xs text-yellow-400">
                {scanError()}
              </div>
            </Show>

            {/* Found Intents */}
            <Show when={foundIntents().length > 0}>
              <div class="space-y-2">
                <p class="text-xs text-zinc-400">Found {foundIntents().length} deposit(s):</p>
                <For each={foundIntents()}>
                  {(intent) => (
                    <button
                      onClick={() => selectIntent(intent)}
                      class="w-full text-left p-2 bg-zinc-700 hover:bg-zinc-600 rounded text-sm transition-colors"
                    >
                      <div class="flex justify-between items-center">
                        <span class="text-zinc-300 font-mono text-xs">
                          {intent.intentId.slice(0, 10)}...{intent.intentId.slice(-8)}
                        </span>
                        <span class="text-zinc-400">{formatUSDC(intent.amount)} USDC</span>
                      </div>
                      <div class="text-xs text-zinc-500 mt-1">
                        Shares: {intent.shares.toString()} | Block: {intent.blockNumber.toString()}
                      </div>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* Divider */}
          <div class="flex items-center gap-2">
            <div class="flex-1 border-t border-zinc-700"></div>
            <span class="text-xs text-zinc-600">or enter intent ID manually</span>
            <div class="flex-1 border-t border-zinc-700"></div>
          </div>

          <div>
            <label class="block text-sm text-zinc-400 mb-1">Intent ID</label>
            <div class="flex gap-2">
              <input
                type="text"
                value={intentId()}
                onInput={(e) => setIntentId(e.currentTarget.value)}
                placeholder="0x..."
                class="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
              <button
                onClick={handleQuery}
                disabled={isQuerying() || !intentId().trim()}
                class="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-100 text-sm font-medium rounded transition-colors"
              >
                {isQuerying() ? "Querying..." : "Query"}
              </button>
            </div>
            <p class="text-xs text-zinc-600 mt-1">
              Find your intent ID in the browser console from when you executed the deposit
            </p>
          </div>

          {/* Query Error */}
          <Show when={queryError()}>
            <div class="p-3 bg-red-900/20 border border-red-800 rounded text-sm text-red-400">
              {queryError()}
            </div>
          </Show>

          {/* Cancel Success */}
          <Show when={cancelSuccess()}>
            <div class="p-3 bg-green-900/20 border border-green-800 rounded text-sm text-green-400">
              {cancelSuccess()}
            </div>
          </Show>

          {/* Deposit Info */}
          <Show when={depositInfo()}>
            {(info) => (
              <div class="bg-zinc-800 rounded p-4 space-y-3">
                <h3 class="text-sm font-medium text-zinc-200">Pending Deposit Found</h3>

                <div class="grid grid-cols-2 gap-2 text-sm">
                  <div class="text-zinc-500">Status:</div>
                  <div class="text-zinc-200">
                    <span
                      class={
                        info().status === L2PositionStatus.PendingDeposit
                          ? "text-yellow-400"
                          : info().status === L2PositionStatus.Active
                            ? "text-green-400"
                            : "text-zinc-400"
                      }
                    >
                      {getStatusLabel(info().status)}
                    </span>
                  </div>

                  <div class="text-zinc-500">Net Amount:</div>
                  <div class="text-zinc-200">{formatUSDC(info().netAmount)} USDC</div>

                  <div class="text-zinc-500">Deadline:</div>
                  <div class="text-zinc-200">{formatTimestamp(info().deadline)}</div>

                  <div class="text-zinc-500">Already Consumed:</div>
                  <div class={info().isConsumed ? "text-red-400" : "text-green-400"}>
                    {info().isConsumed ? "Yes" : "No"}
                  </div>

                  <div class="text-zinc-500">Can Cancel:</div>
                  <div class={info().canCancel ? "text-green-400" : "text-yellow-400"}>
                    {info().canCancel ? "Yes" : "No"}
                  </div>

                  <Show when={!info().canCancel && info().timeUntilCancellable > 0}>
                    <div class="text-zinc-500">Time Until Cancellable:</div>
                    <div class="text-yellow-400">
                      {Math.ceil(info().timeUntilCancellable / 60)} minutes
                    </div>
                  </Show>

                  <div class="text-zinc-500">Secret Stored:</div>
                  <div class={secretExists() ? "text-green-400" : "text-red-400"}>
                    {secretExists() ? "Yes" : "No"}
                  </div>
                </div>

                {/* Complete Deposit Button - show if not consumed and secret exists */}
                <Show when={!info().isConsumed && secretExists()}>
                  <div class="pt-2">
                    <button
                      onClick={handleCompleteDeposit}
                      disabled={isCompleting()}
                      class="w-full px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium rounded transition-colors"
                    >
                      {isCompleting() ? "Completing..." : "Complete Deposit (Create Position)"}
                    </button>
                  </div>
                </Show>

                {/* Complete Success */}
                <Show when={completeSuccess()}>
                  <div class="p-2 bg-green-900/20 border border-green-800 rounded text-xs text-green-400">
                    {completeSuccess()}
                  </div>
                </Show>

                {/* Complete Error */}
                <Show when={completeError()}>
                  <div class="p-2 bg-red-900/20 border border-red-800 rounded text-xs text-red-400">
                    {completeError()}
                  </div>
                </Show>

                {/* No Secret Warning */}
                <Show when={!info().isConsumed && !secretExists()}>
                  <div class="p-2 bg-yellow-900/20 border border-yellow-800 rounded text-xs text-yellow-400">
                    <strong>Secret not found.</strong> The secret was not stored during the original
                    deposit. This deposit cannot be completed normally. Your options:
                    <ul class="list-disc ml-4 mt-1">
                      <li>Wait for the deadline to pass, then cancel to recover your tokens</li>
                      <li>
                        If you saved the secret elsewhere, you can complete manually via console
                      </li>
                    </ul>
                  </div>
                </Show>

                {/* Cancel Button */}
                <Show when={info().canCancel}>
                  <div class="pt-2">
                    <button
                      onClick={handleCancel}
                      disabled={isCancelling()}
                      class="w-full px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium rounded transition-colors"
                    >
                      {isCancelling()
                        ? "Cancelling..."
                        : `Cancel & Recover ${formatUSDC(info().netAmount)} USDC`}
                    </button>
                  </div>
                </Show>

                {/* Not Cancellable Warning */}
                <Show when={!info().canCancel && !info().isConsumed}>
                  <div class="p-2 bg-yellow-900/20 border border-yellow-800 rounded text-xs text-yellow-400">
                    You cannot cancel yet. Wait until the deadline passes.
                  </div>
                </Show>

                {/* Already Consumed Warning */}
                <Show when={info().isConsumed}>
                  <div class="p-2 bg-red-900/20 border border-red-800 rounded text-xs text-red-400">
                    This intent has already been consumed. If you have a position, refresh from L2.
                    If not, the deposit may have failed on L1.
                  </div>
                </Show>

                {/* Cancel Error */}
                <Show when={cancelError()}>
                  <div class="p-2 bg-red-900/20 border border-red-800 rounded text-xs text-red-400">
                    {cancelError()}
                  </div>
                </Show>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </section>
  );
}
