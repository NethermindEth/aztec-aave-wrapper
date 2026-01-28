/**
 * Recover Deposit Component
 *
 * Allows users to query and cancel stuck pending deposits where
 * finalize_deposit failed but tokens were already burned.
 */

import { createSignal, For, type JSX, Show } from "solid-js";
import { createL1PublicClient } from "../services/l1/client";
import { getIntentShares } from "../services/l1/portal";
import { loadContractWithAzguard, loadContractWithDevWallet } from "../services/l2/contract";
import { executeFinalizeDeposit, getSponsoredFeePaymentMethod } from "../services/l2/operations";
import {
  type FoundIntent,
  L2PositionStatus,
  type PendingDepositInfo,
  queryPendingDeposit,
  scanUserIntentsFromL1,
} from "../services/l2/positions";
import { getSecret, hasSecret } from "../services/secrets";
import { connectWallet, isDevWallet } from "../services/wallet/index.js";
import { useAppState } from "../store/hooks";
import { formatUSDC } from "../types/state";

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
 * Chevron icon component for accordion
 */
function ChevronIcon(): JSX.Element {
  return (
    <svg
      class="w-4 h-4 text-zinc-500 transition-transform duration-200"
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
      const { wallet } = await connectWallet();
      const { contract } = isDevWallet(wallet)
        ? await loadContractWithDevWallet(wallet, state.contracts.l2Wrapper)
        : await loadContractWithAzguard(wallet, state.contracts.l2Wrapper);

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
      const { wallet, address: walletAddress } = await connectWallet();
      const { contract } = isDevWallet(wallet)
        ? await loadContractWithDevWallet(wallet, state.contracts.l2Wrapper)
        : await loadContractWithAzguard(wallet, state.contracts.l2Wrapper);

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
      const { wallet, address: walletAddress } = await connectWallet();
      const { contract } = isDevWallet(wallet)
        ? await loadContractWithDevWallet(wallet, state.contracts.l2Wrapper)
        : await loadContractWithAzguard(wallet, state.contracts.l2Wrapper);

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
      const secretFr = Fr.fromString(secretEntry.secretHex);
      // Asset ID is the USDC address as a bigint (matches L1 encoding)
      const assetId = BigInt(state.contracts.mockUsdc);

      console.log("[handleCompleteDeposit] Calling finalize_deposit with:");
      console.log("  intentId:", info.intentId);
      console.log("  assetId:", assetId.toString());
      console.log("  shares:", shares.toString());
      console.log("  secret:", `${secretEntry.secretHex.slice(0, 20)}...`);

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
      const { wallet, address: walletAddress } = await connectWallet();
      const { contract } = isDevWallet(wallet)
        ? await loadContractWithDevWallet(wallet, state.contracts.l2Wrapper)
        : await loadContractWithAzguard(wallet, state.contracts.l2Wrapper);

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
    <div class="glass-card !p-0 overflow-hidden">
      {/* Collapsible Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded())}
        class="w-full flex items-center justify-between p-4 hover:bg-white/[0.02] transition-colors"
        aria-expanded={isExpanded()}
        aria-controls="recover-deposit-content"
      >
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <svg
              class="w-4 h-4 text-amber-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div class="text-left">
            <div class="text-sm font-medium text-zinc-200">Recover Stuck Deposit</div>
            <p class="text-xs text-zinc-500">Query and cancel failed deposits to recover tokens</p>
          </div>
        </div>
        <div class={`transition-transform duration-200 ${isExpanded() ? "rotate-180" : ""}`}>
          <ChevronIcon />
        </div>
      </button>

      {/* Collapsible Content */}
      <Show when={isExpanded()}>
        <div class="px-4 pb-4 space-y-4 border-t border-white/5" id="recover-deposit-content">
          {/* Scan Section */}
          <div class="mt-4 p-4 rounded-lg bg-black/20 border border-white/5 space-y-3">
            <div class="flex items-center justify-between gap-4">
              <div>
                <h3 class="text-sm font-medium text-zinc-200">Find My Deposits</h3>
                <p class="text-xs text-zinc-500">Scan L1 events to find your pending deposits</p>
              </div>
              <button
                type="button"
                onClick={handleScan}
                disabled={isScanning()}
                class="btn-cta !w-auto !px-4 !py-2 text-sm"
              >
                {isScanning() ? "Scanning..." : "Scan"}
              </button>
            </div>

            {/* Scan Error */}
            <Show when={scanError()}>
              <div class="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
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
                      type="button"
                      onClick={() => selectIntent(intent)}
                      class="w-full text-left p-3 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 hover:border-white/10 transition-all"
                    >
                      <div class="flex justify-between items-center">
                        <span class="text-zinc-300 font-mono text-xs">
                          {intent.intentId.slice(0, 10)}...{intent.intentId.slice(-8)}
                        </span>
                        <span class="text-zinc-300 font-medium">
                          {formatUSDC(intent.amount)} USDC
                        </span>
                      </div>
                      <div class="text-[10px] text-zinc-500 mt-1 font-mono">
                        Shares: {intent.shares.toString()} | Block: {intent.blockNumber.toString()}
                      </div>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* Divider */}
          <div class="flex items-center gap-3">
            <div class="flex-1 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            <span class="text-[10px] text-zinc-600 uppercase tracking-wider">
              or enter manually
            </span>
            <div class="flex-1 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          </div>

          {/* Manual Input */}
          <div>
            <label class="block text-xs text-zinc-500 mb-2">Intent ID</label>
            <div class="flex gap-2">
              <div class="flex-1 input-wrapper">
                <input
                  type="text"
                  value={intentId()}
                  onInput={(e) => setIntentId(e.currentTarget.value)}
                  placeholder="0x..."
                  class="input-field !text-left !text-sm"
                />
              </div>
              <button
                type="button"
                onClick={handleQuery}
                disabled={isQuerying() || !intentId().trim()}
                class="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-300 text-sm font-medium border border-white/10 hover:border-white/20 transition-all"
              >
                {isQuerying() ? "..." : "Query"}
              </button>
            </div>
            <p class="text-[10px] text-zinc-600 mt-1.5">
              Find your intent ID in the browser console from when you executed the deposit
            </p>
          </div>

          {/* Query Error */}
          <Show when={queryError()}>
            <div class="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
              {queryError()}
            </div>
          </Show>

          {/* Cancel Success */}
          <Show when={cancelSuccess()}>
            <div class="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400">
              {cancelSuccess()}
            </div>
          </Show>

          {/* Deposit Info */}
          <Show when={depositInfo()}>
            {(info) => (
              <div class="p-4 rounded-lg bg-white/[0.02] border border-white/5 space-y-4">
                <h3 class="text-sm font-medium text-zinc-200">Pending Deposit Found</h3>

                <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div class="text-zinc-500">Status</div>
                  <div>
                    <span
                      class={`px-2 py-0.5 rounded text-xs font-medium ${
                        info().status === L2PositionStatus.PendingDeposit
                          ? "bg-amber-500/20 text-amber-400"
                          : info().status === L2PositionStatus.Active
                            ? "bg-emerald-500/20 text-emerald-400"
                            : "bg-zinc-500/20 text-zinc-400"
                      }`}
                    >
                      {getStatusLabel(info().status)}
                    </span>
                  </div>

                  <div class="text-zinc-500">Net Amount</div>
                  <div class="text-zinc-200 font-mono">{formatUSDC(info().netAmount)} USDC</div>

                  <div class="text-zinc-500">Deadline</div>
                  <div class="text-zinc-200 font-mono text-xs">
                    {formatTimestamp(info().deadline)}
                  </div>

                  <div class="text-zinc-500">Consumed</div>
                  <div class={info().isConsumed ? "text-red-400" : "text-emerald-400"}>
                    {info().isConsumed ? "Yes" : "No"}
                  </div>

                  <div class="text-zinc-500">Can Cancel</div>
                  <div class={info().canCancel ? "text-emerald-400" : "text-amber-400"}>
                    {info().canCancel ? "Yes" : "No"}
                  </div>

                  <Show when={!info().canCancel && info().timeUntilCancellable > 0}>
                    <div class="text-zinc-500">Time Until Cancellable</div>
                    <div class="text-amber-400 font-mono">
                      {Math.ceil(info().timeUntilCancellable / 60)} min
                    </div>
                  </Show>

                  <div class="text-zinc-500">Secret Stored</div>
                  <div class={secretExists() ? "text-emerald-400" : "text-red-400"}>
                    {secretExists() ? "Yes" : "No"}
                  </div>
                </div>

                {/* Complete Deposit Button - show if not consumed and secret exists */}
                <Show when={!info().isConsumed && secretExists()}>
                  <button
                    type="button"
                    onClick={handleCompleteDeposit}
                    disabled={isCompleting()}
                    class="btn-cta ready"
                  >
                    {isCompleting() ? "Completing..." : "Complete Deposit (Create Position)"}
                  </button>
                </Show>

                {/* Complete Success */}
                <Show when={completeSuccess()}>
                  <div class="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400">
                    {completeSuccess()}
                  </div>
                </Show>

                {/* Complete Error */}
                <Show when={completeError()}>
                  <div class="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                    {completeError()}
                  </div>
                </Show>

                {/* No Secret Warning */}
                <Show when={!info().isConsumed && !secretExists()}>
                  <div class="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
                    <strong>Secret not found.</strong> The secret was not stored during the original
                    deposit. This deposit cannot be completed normally. Your options:
                    <ul class="list-disc ml-4 mt-1 space-y-0.5">
                      <li>Wait for the deadline to pass, then cancel to recover your tokens</li>
                      <li>
                        If you saved the secret elsewhere, you can complete manually via console
                      </li>
                    </ul>
                  </div>
                </Show>

                {/* Cancel Button */}
                <Show when={info().canCancel}>
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={isCancelling()}
                    class="w-full px-4 py-3 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-amber-400 font-medium border border-amber-500/30 transition-all"
                  >
                    {isCancelling()
                      ? "Cancelling..."
                      : `Cancel & Recover ${formatUSDC(info().netAmount)} USDC`}
                  </button>
                </Show>

                {/* Not Cancellable Warning */}
                <Show when={!info().canCancel && !info().isConsumed}>
                  <div class="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
                    You cannot cancel yet. Wait until the deadline passes.
                  </div>
                </Show>

                {/* Already Consumed Warning */}
                <Show when={info().isConsumed}>
                  <div class="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                    This intent has already been consumed. If you have a position, refresh from L2.
                    If not, the deposit may have failed on L1.
                  </div>
                </Show>

                {/* Cancel Error */}
                <Show when={cancelError()}>
                  <div class="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                    {cancelError()}
                  </div>
                </Show>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}
