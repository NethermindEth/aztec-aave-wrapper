/**
 * BridgeFlow Component
 *
 * Bridge flow interface for transferring USDC from L1 (Ethereum) to L2 (Aztec).
 * This is a prerequisite step before users can deposit to Aave with privacy.
 *
 * BRIDGE FLOW (2 steps - L1 only):
 * 1. Approve TokenPortal to spend USDC on L1
 * 2. Deposit to TokenPortal (creates L1→L2 message)
 *
 * After bridge completes, user must claim tokens on L2 via ClaimPendingBridges.
 */

import { createSignal, Match, Show, Switch } from "solid-js";
import { useApp } from "../store/hooks.js";
import { fromBigIntString } from "../types/state.js";
import { type StepConfig, StepIndicator } from "./StepIndicator";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Label } from "./ui/label";

/**
 * Bridge flow step configuration with labels, descriptions, and time estimates.
 * Only L1 steps - L2 claim is handled separately via ClaimPendingBridges.
 */
const BRIDGE_STEPS: StepConfig[] = [
  {
    label: "Approve TokenPortal",
    description: "Approving TokenPortal to spend your USDC on L1",
    estimatedSeconds: 15,
  },
  {
    label: "Deposit to TokenPortal",
    description: "Locking USDC and creating L1→L2 message",
    estimatedSeconds: 30,
  },
];

/**
 * Props for BridgeFlow component
 */
export interface BridgeFlowProps {
  /** Callback when bridge is initiated */
  onBridge?: (amount: bigint) => void;
  /** Optional: CSS class for the container */
  class?: string;
}

/**
 * Validate amount input
 * @returns Error message or null if valid
 */
function validateAmount(amountStr: string, maxBalance: bigint): string | null {
  if (!amountStr || amountStr.trim() === "") {
    return "Amount is required";
  }

  const amount = parseFloat(amountStr);
  if (Number.isNaN(amount)) {
    return "Invalid amount";
  }

  if (amount <= 0) {
    return "Amount must be positive";
  }

  // Convert to raw units (6 decimals for USDC)
  const amountRaw = parseAmountToRaw(amountStr);
  if (amountRaw > maxBalance) {
    return "Amount exceeds L1 USDC balance";
  }

  return null;
}

/**
 * Parse amount string to raw units (6 decimals for USDC)
 */
function parseAmountToRaw(amountStr: string): bigint {
  const parts = amountStr.split(".");
  const wholePart = parts[0] || "0";
  let decimalPart = parts[1] || "";

  // Pad or truncate to 6 decimals
  decimalPart = decimalPart.slice(0, 6).padEnd(6, "0");

  return BigInt(wholePart + decimalPart);
}

/**
 * Format raw amount for display (6 decimals)
 */
function formatAmount(raw: bigint): string {
  const wholePart = raw / 1_000_000n;
  const decimalPart = raw % 1_000_000n;
  const decimalStr = decimalPart.toString().padStart(6, "0").replace(/0+$/, "");

  if (decimalStr) {
    return `${wholePart}.${decimalStr}`;
  }
  return wholePart.toString();
}

/**
 * BridgeFlow renders a bridge interface with:
 * - Amount input with validation
 * - Step indicator during active bridge (2 steps - L1 only)
 * - Error display
 * - Action button
 *
 * @example
 * ```tsx
 * <BridgeFlow
 *   onBridge={(amount) => {
 *     console.log(`Bridge ${amount} USDC to L2`);
 *   }}
 * />
 * ```
 */
export function BridgeFlow(props: BridgeFlowProps) {
  const { state } = useApp();

  // Local form state
  const [amount, setAmount] = createSignal("");
  const [validationError, setValidationError] = createSignal<string | null>(null);

  // Derived state - bridge uses "deposit" operation type for UI consistency
  const isOperationActive = () => state.operation.type === "deposit";
  const isProcessing = () => isOperationActive() && state.operation.status === "pending";

  const currentStepConfig = () => {
    if (!isOperationActive()) return null;
    const step = state.operation.step;
    return BRIDGE_STEPS[step - 1] ?? null;
  };

  const currentStepLabel = () => currentStepConfig()?.label ?? "";
  const currentStepDescription = () => currentStepConfig()?.description ?? "";
  const currentStepEstimate = () => currentStepConfig()?.estimatedSeconds;

  // Use L1 USDC balance (this would need to be added to state for production)
  // For now, we'll use a placeholder that would be passed in or fetched
  const maxL1Balance = () => fromBigIntString(state.wallet.usdcBalance);

  const canBridge = () => {
    // Must have L1 wallet connected
    if (!state.wallet.l1Address) {
      return false;
    }

    // Must have L2 wallet connected
    if (!state.wallet.l2Address) {
      return false;
    }

    // Must not have active operation
    if (state.operation.type !== "idle") {
      return false;
    }

    // Must have valid amount
    const amountError = validateAmount(amount(), maxL1Balance());
    if (amountError) {
      return false;
    }

    return true;
  };

  const handleAmountChange = (value: string) => {
    // Only allow valid number input
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setAmount(value);
      // Clear validation error on input
      setValidationError(null);
    }
  };

  const handleBridge = () => {
    // Validate amount
    const amountError = validateAmount(amount(), maxL1Balance());
    if (amountError) {
      setValidationError(amountError);
      return;
    }

    // Parse amount and call handler
    const amountRaw = parseAmountToRaw(amount());
    props.onBridge?.(amountRaw);
  };

  const handleMaxClick = () => {
    // Set amount to max L1 balance
    const balance = maxL1Balance();
    if (balance > 0n) {
      setAmount(formatAmount(balance));
      setValidationError(null);
    }
  };

  // Determine error to display (only operation errors, validation shown inline)
  const displayError = () => state.operation.error;

  return (
    <Card class={props.class}>
      <CardHeader>
        <CardTitle class="text-lg">Bridge USDC to L2</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        {/* Info Alert */}
        <Alert>
          <AlertDescription>
            Bridge USDC from Ethereum L1 to Aztec L2 before depositing to Aave with privacy.
          </AlertDescription>
        </Alert>

        {/* Amount Input */}
        <div class="space-y-2">
          <Label for="bridge-amount">Amount</Label>
          <div
            class={`input-wrapper${validationError() ? " error" : ""}${isProcessing() ? " disabled" : ""}`}
          >
            <div class="input-token">
              <svg
                class="input-token-icon"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="12" fill="#2775CA" />
                <path
                  d="M12 17.5c-3.03 0-5.5-2.47-5.5-5.5S8.97 6.5 12 6.5s5.5 2.47 5.5 5.5-2.47 5.5-5.5 5.5zm0-10c-2.48 0-4.5 2.02-4.5 4.5s2.02 4.5 4.5 4.5 4.5-2.02 4.5-4.5-2.02-4.5-4.5-4.5z"
                  fill="white"
                />
                <path
                  d="M12.75 14.25h-1.5v-.75h1.5v.75zm0-3h-1.5V9.75h1.5v1.5zm.75 1.5h-3v-1.5h3v1.5z"
                  fill="white"
                />
              </svg>
              <span class="input-token-symbol">USDC</span>
            </div>
            <input
              id="bridge-amount"
              type="text"
              inputMode="decimal"
              class="input-field"
              placeholder="0.00"
              value={amount()}
              onInput={(e) => handleAmountChange(e.currentTarget.value)}
              disabled={isProcessing()}
              aria-invalid={validationError() ? "true" : undefined}
              aria-describedby={validationError() ? "bridge-amount-error" : undefined}
            />
            <button
              type="button"
              class="btn-max"
              onClick={handleMaxClick}
              disabled={isProcessing()}
            >
              Max
            </button>
          </div>
          <Show when={validationError()}>
            <p id="bridge-amount-error" class="input-error text-sm">
              {validationError()}
            </p>
          </Show>
        </div>

        {/* Step Progress */}
        <Show when={isOperationActive()}>
          <StepIndicator
            currentStep={state.operation.step}
            totalSteps={BRIDGE_STEPS.length}
            stepLabel={currentStepLabel()}
            description={currentStepDescription()}
            estimatedSecondsRemaining={currentStepEstimate()}
          />
        </Show>

        {/* Error Alert */}
        <Show when={displayError()}>
          <Alert variant="destructive">
            <AlertDescription>{displayError()}</AlertDescription>
          </Alert>
        </Show>
      </CardContent>
      <CardFooter>
        <Button class="w-full" disabled={!canBridge() || isProcessing()} onClick={handleBridge}>
          <Switch fallback="Bridge to L2">
            <Match when={isProcessing()}>Processing...</Match>
            <Match when={!state.wallet.l1Address}>Connect ETH Wallet</Match>
            <Match when={!state.wallet.l2Address}>Connect Aztec Wallet</Match>
          </Switch>
        </Button>
      </CardFooter>
    </Card>
  );
}
