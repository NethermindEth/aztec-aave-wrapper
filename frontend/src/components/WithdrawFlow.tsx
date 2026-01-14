/**
 * WithdrawFlow Component
 *
 * Withdraw flow interface with position selector, step indicator,
 * and action button. Supports full withdrawal only (MVP constraint).
 */

import { createMemo, createSignal, Match, Show, Switch } from "solid-js";
import { useApp } from "../store/hooks.js";
import { IntentStatus } from "../types/index.js";
import type { PositionDisplay } from "../types/state.js";
import { StepIndicator } from "./StepIndicator";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Select, type SelectOption } from "./ui/select";

/**
 * Withdraw flow step labels
 */
const WITHDRAW_STEP_LABELS = [
  "Request withdrawal on L2",
  "Wait for L2→L1 message",
  "Execute withdrawal on L1",
  "Finalize withdrawal on L2",
];

/**
 * Props for WithdrawFlow component
 */
export interface WithdrawFlowProps {
  /** Callback when withdrawal is initiated */
  onWithdraw?: (intentId: string) => void;
  /** Optional: CSS class for the container */
  class?: string;
}

/**
 * Convert positions to select options
 */
function positionsToOptions(positions: PositionDisplay[]): SelectOption[] {
  return positions
    .filter((p) => p.status === IntentStatus.Active)
    .map((p) => ({
      value: p.intentId,
      label: `${p.sharesFormatted} (${p.intentId.slice(0, 10)}...)`,
    }));
}

/**
 * WithdrawFlow renders a withdrawal interface with:
 * - Position selector populated from state
 * - Full withdrawal only constraint notice
 * - Step indicator during active withdrawal
 * - Error display
 * - Action button
 *
 * @example
 * ```tsx
 * <WithdrawFlow
 *   onWithdraw={(intentId) => {
 *     console.log(`Withdraw position ${intentId}`);
 *   }}
 * />
 * ```
 */
export function WithdrawFlow(props: WithdrawFlowProps) {
  const { state } = useApp();

  // Local form state
  const [selectedPosition, setSelectedPosition] = createSignal<string>("");
  const [validationError, setValidationError] = createSignal<string | null>(null);

  // Derived state
  const positionOptions = createMemo(() => positionsToOptions(state.positions));

  const selectedPositionData = createMemo(() =>
    state.positions.find((p) => p.intentId === selectedPosition())
  );

  const isOperationActive = () => state.operation.type === "withdraw";
  const isProcessing = () => isOperationActive() && state.operation.status === "pending";

  const currentStepLabel = () => {
    if (!isOperationActive()) return "";
    const step = state.operation.step;
    return WITHDRAW_STEP_LABELS[step - 1] ?? "";
  };

  const hasPositions = () => positionOptions().length > 0;

  const canWithdraw = () => {
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

    // Must have a position selected
    if (!selectedPosition()) {
      return false;
    }

    // Selected position must exist and be active (deposit finalized)
    const position = selectedPositionData();
    if (!position || position.status !== IntentStatus.Active) {
      return false;
    }

    return true;
  };

  const handlePositionChange = (value: string) => {
    setSelectedPosition(value);
    setValidationError(null);
  };

  const handleWithdraw = () => {
    // Validate position selection
    if (!selectedPosition()) {
      setValidationError("Please select a position to withdraw");
      return;
    }

    const position = selectedPositionData();
    if (!position) {
      setValidationError("Selected position not found");
      return;
    }

    if (position.status !== IntentStatus.Active) {
      setValidationError("Position is not available for withdrawal");
      return;
    }

    // Call handler
    props.onWithdraw?.(selectedPosition());
  };

  // Determine error to display (validation error or operation error)
  const displayError = () => validationError() ?? state.operation.error;

  return (
    <Card class={props.class}>
      <CardHeader>
        <CardTitle class="text-lg">Withdraw from Aave</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        {/* Position Selector */}
        <div class="space-y-2">
          <label class="text-sm font-medium" for="withdraw-position">
            Select Position
          </label>
          <Show
            when={hasPositions()}
            fallback={
              <p class="text-sm text-muted-foreground py-2">
                No positions available for withdrawal
              </p>
            }
          >
            <Select
              id="withdraw-position"
              options={positionOptions()}
              value={selectedPosition()}
              onChange={handlePositionChange}
              disabled={isProcessing()}
              placeholder="Select a position"
            />
          </Show>
        </div>

        {/* Selected Position Details */}
        <Show when={selectedPositionData()}>
          {(position) => (
            <div class="rounded-md border p-3 space-y-1">
              <div class="flex justify-between text-sm">
                <span class="text-muted-foreground">Amount</span>
                <span class="font-medium">{position().sharesFormatted}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-muted-foreground">Intent ID</span>
                <span class="font-mono text-xs">{position().intentId.slice(0, 18)}...</span>
              </div>
            </div>
          )}
        </Show>

        {/* Full Withdrawal Notice */}
        <Alert>
          <AlertDescription>
            Full withdrawal only. The entire position will be withdrawn.
          </AlertDescription>
        </Alert>

        {/* Step Progress */}
        <Show when={isOperationActive()}>
          <StepIndicator
            currentStep={state.operation.step}
            totalSteps={WITHDRAW_STEP_LABELS.length}
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
        <Button class="w-full" disabled={!canWithdraw() || isProcessing()} onClick={handleWithdraw}>
          <Switch fallback="Withdraw">
            <Match when={isProcessing()}>Processing...</Match>
            <Match when={!state.wallet.l1Address}>Connect Wallet</Match>
            <Match when={!state.contracts.portal}>Deploy Contracts</Match>
            <Match when={!hasPositions()}>No Positions</Match>
          </Switch>
        </Button>
      </CardFooter>
    </Card>
  );
}
