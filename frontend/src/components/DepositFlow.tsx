/**
 * DepositFlow Component
 *
 * Deposit flow interface with amount input, deadline selector,
 * step indicator, and action button.
 */

import { createSignal, Match, Show, Switch } from "solid-js";
import { DEADLINE_CONSTRAINTS } from "../config/constants.js";
import { useApp } from "../store/hooks.js";
import { fromBigIntString } from "../types/state.js";
import { StepIndicator } from "./StepIndicator";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, type SelectOption } from "./ui/select";

/**
 * Deposit flow step labels
 */
const DEPOSIT_STEP_LABELS = [
  "Generate secret",
  "Request deposit on L2",
  "Wait for L2→L1 message",
  "Fund portal with USDC",
  "Execute deposit on L1",
  "Finalize deposit on L2",
];

/**
 * Deadline options for the selector
 */
const DEADLINE_OPTIONS: SelectOption[] = [
  { value: "1800", label: "30 minutes" },
  { value: "3600", label: "1 hour" },
  { value: "7200", label: "2 hours" },
  { value: "14400", label: "4 hours" },
  { value: "43200", label: "12 hours" },
  { value: "86400", label: "24 hours" },
];

/**
 * Props for DepositFlow component
 */
export interface DepositFlowProps {
  /** Callback when deposit is initiated */
  onDeposit?: (amount: bigint, deadlineSeconds: number) => void;
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
    return "Amount exceeds balance";
  }

  return null;
}

/**
 * Validate deadline selection
 * @returns Error message or null if valid
 */
function validateDeadline(deadlineSeconds: number): string | null {
  if (deadlineSeconds < DEADLINE_CONSTRAINTS.MIN_OFFSET_SECONDS) {
    return `Deadline must be at least ${DEADLINE_CONSTRAINTS.MIN_OFFSET_SECONDS / 60} minutes`;
  }

  if (deadlineSeconds > DEADLINE_CONSTRAINTS.MAX_OFFSET_SECONDS) {
    return `Deadline cannot exceed ${DEADLINE_CONSTRAINTS.MAX_OFFSET_SECONDS / 3600} hours`;
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
 * DepositFlow renders a deposit interface with:
 * - Amount input with validation
 * - Deadline selector with min/max constraints
 * - Step indicator during active deposit
 * - Error display
 * - Action button
 *
 * @example
 * ```tsx
 * <DepositFlow
 *   onDeposit={(amount, deadline) => {
 *     console.log(`Deposit ${amount} with deadline ${deadline}s`);
 *   }}
 * />
 * ```
 */
export function DepositFlow(props: DepositFlowProps) {
  const { state } = useApp();

  // Local form state
  const [amount, setAmount] = createSignal("");
  const [deadline, setDeadline] = createSignal(
    DEADLINE_CONSTRAINTS.DEFAULT_OFFSET_SECONDS.toString()
  );
  const [validationError, setValidationError] = createSignal<string | null>(null);

  // Derived state
  const isOperationActive = () => state.operation.type === "deposit";
  const isProcessing = () => isOperationActive() && state.operation.status === "pending";

  const currentStepLabel = () => {
    if (!isOperationActive()) return "";
    const step = state.operation.step;
    return DEPOSIT_STEP_LABELS[step - 1] ?? "";
  };

  const maxBalance = () => fromBigIntString(state.wallet.usdcBalance);

  const canDeposit = () => {
    // Must have wallet connected
    if (!state.wallet.l1Address || !state.wallet.l2Address) {
      return false;
    }

    // Must have contracts deployed
    if (!state.contracts.portal || !state.contracts.l2Wrapper) {
      return false;
    }

    // Must not have active operation
    if (state.operation.type !== "idle") {
      return false;
    }

    // Must have valid amount
    const amountError = validateAmount(amount(), maxBalance());
    if (amountError) {
      return false;
    }

    // Must have valid deadline
    const deadlineError = validateDeadline(parseInt(deadline(), 10));
    if (deadlineError) {
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

  const handleDeadlineChange = (value: string) => {
    setDeadline(value);
    setValidationError(null);
  };

  const handleDeposit = () => {
    // Validate amount
    const amountError = validateAmount(amount(), maxBalance());
    if (amountError) {
      setValidationError(amountError);
      return;
    }

    // Validate deadline
    const deadlineSeconds = parseInt(deadline(), 10);
    const deadlineError = validateDeadline(deadlineSeconds);
    if (deadlineError) {
      setValidationError(deadlineError);
      return;
    }

    // Parse amount and call handler
    const amountRaw = parseAmountToRaw(amount());
    props.onDeposit?.(amountRaw, deadlineSeconds);
  };

  const handleMaxClick = () => {
    // Set amount to max balance
    const balance = maxBalance();
    if (balance > 0n) {
      // Format balance for display (6 decimals)
      const wholePart = balance / 1_000_000n;
      const decimalPart = balance % 1_000_000n;
      const decimalStr = decimalPart.toString().padStart(6, "0").replace(/0+$/, "");

      if (decimalStr) {
        setAmount(`${wholePart}.${decimalStr}`);
      } else {
        setAmount(wholePart.toString());
      }
      setValidationError(null);
    }
  };

  // Determine error to display (validation error or operation error)
  const displayError = () => validationError() ?? state.operation.error;

  return (
    <Card class={props.class}>
      <CardHeader>
        <CardTitle class="text-lg">Deposit to Aave</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        {/* Amount Input */}
        <div class="space-y-2">
          <div class="flex justify-between">
            <Label for="deposit-amount">Amount (USDC)</Label>
            <button
              type="button"
              class="text-xs text-primary hover:underline"
              onClick={handleMaxClick}
              disabled={isProcessing()}
            >
              Max
            </button>
          </div>
          <Input
            id="deposit-amount"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount()}
            onInput={(e) => handleAmountChange(e.currentTarget.value)}
            disabled={isProcessing()}
          />
        </div>

        {/* Deadline Selector */}
        <div class="space-y-2">
          <Label for="deposit-deadline">Deadline</Label>
          <Select
            id="deposit-deadline"
            options={DEADLINE_OPTIONS}
            value={deadline()}
            onChange={handleDeadlineChange}
            disabled={isProcessing()}
            placeholder="Select deadline"
          />
          <p class="text-xs text-muted-foreground">Transaction must complete within this time</p>
        </div>

        {/* Step Progress */}
        <Show when={isOperationActive()}>
          <StepIndicator
            currentStep={state.operation.step}
            totalSteps={DEPOSIT_STEP_LABELS.length}
            stepLabel={currentStepLabel()}
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
        <Button class="w-full" disabled={!canDeposit() || isProcessing()} onClick={handleDeposit}>
          <Switch fallback="Deposit">
            <Match when={isProcessing()}>Processing...</Match>
            <Match when={!state.wallet.l1Address}>Connect ETH Wallet</Match>
            <Match when={!state.wallet.l2Address}>Connect Aztec Wallet</Match>
            <Match when={!state.contracts.portal}>Loading Contracts...</Match>
            <Match when={!state.contracts.l2Wrapper}>Loading L2 Contract...</Match>
          </Switch>
        </Button>
      </CardFooter>
    </Card>
  );
}
