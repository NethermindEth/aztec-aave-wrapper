/**
 * WithdrawFlow Component
 *
 * Withdraw flow interface with position selector, step indicator,
 * and action button. Supports full withdrawal only (MVP constraint).
 */

import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { hasSecret } from "../services/secrets.js";
import { useApp } from "../store/hooks.js";
import { IntentStatus } from "../types/index.js";
import type { PositionDisplay } from "../types/state.js";
import { type StepConfig, StepIndicator } from "./StepIndicator";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Select, type SelectOption } from "./ui/select";

/**
 * Withdraw flow step configuration with labels, descriptions, and time estimates
 */
const WITHDRAW_STEPS: StepConfig[] = [
  {
    label: "Request withdrawal on L2",
    description: "Creating a private withdrawal intent on Aztec L2",
    estimatedSeconds: 15,
  },
  {
    label: "Wait for L2→L1 message",
    description: "Waiting for cross-chain message to propagate",
    estimatedSeconds: 60,
  },
  {
    label: "Execute withdrawal on L1",
    description: "Withdrawing from Aave and sending funds to portal",
    estimatedSeconds: 30,
  },
  {
    label: "Finalize withdrawal on L2",
    description: "Completing withdrawal and nullifying position receipt",
    estimatedSeconds: 15,
  },
  {
    label: "Claim tokens on L2",
    description: "Claiming withdrawn tokens via BridgedToken contract",
    estimatedSeconds: 15,
  },
];

/**
 * Props for WithdrawFlow component
 */
export interface WithdrawFlowProps {
  /** Callback when withdrawal is initiated */
  onWithdraw?: (intentId: string) => void;
  /** Callback when claim is initiated for a pending withdrawal */
  onClaim?: (intentId: string) => void;
  /** Optional: CSS class for the container */
  class?: string;
}

/**
 * Convert positions to select options
 */
function positionsToOptions(positions: PositionDisplay[]): SelectOption[] {
  return positions
    .filter((p) => p.status === IntentStatus.Confirmed)
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

  // Positions pending claim (PendingWithdraw status with stored secret)
  const pendingClaims = createMemo(() =>
    state.positions.filter(
      (p) => p.status === IntentStatus.PendingWithdraw && hasSecret(p.intentId)
    )
  );

  const hasPendingClaims = () => pendingClaims().length > 0;

  const isOperationActive = () =>
    state.operation.type === "withdraw" || state.operation.type === "claim";
  const isClaimActive = () => state.operation.type === "claim";
  const isProcessing = () => isOperationActive() && state.operation.status === "pending";

  const currentStepConfig = () => {
    if (!isOperationActive()) return null;
    const step = state.operation.step;
    if (isClaimActive()) {
      // Claim steps map to the last step in WITHDRAW_STEPS (Claim tokens on L2)
      return WITHDRAW_STEPS[WITHDRAW_STEPS.length - 1] ?? null;
    }
    return WITHDRAW_STEPS[step - 1] ?? null;
  };

  const currentStepLabel = () => currentStepConfig()?.label ?? "";
  const currentStepDescription = () => currentStepConfig()?.description ?? "";
  const currentStepEstimate = () => currentStepConfig()?.estimatedSeconds;

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
    if (!position || position.status !== IntentStatus.Confirmed) {
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

    if (position.status !== IntentStatus.Confirmed) {
      setValidationError("Position is not available for withdrawal");
      return;
    }

    // Call handler
    props.onWithdraw?.(selectedPosition());
  };

  const handleClaim = (intentId: string) => {
    if (!intentId || isProcessing()) {
      return;
    }
    props.onClaim?.(intentId);
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
              <div
                class="input-wrapper"
                style={{
                  "justify-content": "center",
                  color: "var(--text-secondary)",
                  "font-size": "0.875rem",
                }}
              >
                No positions available for withdrawal
              </div>
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
            <div class="input-wrapper" style={{ "flex-direction": "column", "align-items": "stretch", gap: "var(--space-sm)" }}>
              <div class="flex justify-between text-sm" style={{ padding: "0 var(--space-sm)" }}>
                <span class="text-muted-foreground">Amount</span>
                <span class="font-medium">{position().sharesFormatted}</span>
              </div>
              <div class="flex justify-between text-sm" style={{ padding: "0 var(--space-sm)" }}>
                <span class="text-muted-foreground">Intent ID</span>
                <span class="font-mono text-xs">{position().intentId.slice(0, 18)}...</span>
              </div>
              {/* Full Withdrawal Indicator */}
              <div
                class="flex items-center justify-center gap-2 text-xs"
                style={{
                  "border-top": "1px solid var(--border-glass)",
                  padding: "var(--space-sm)",
                  background: "var(--bg-glass)",
                  "margin-top": "var(--space-xs)",
                  "border-radius": "0 0 var(--radius-md) var(--radius-md)",
                  color: "var(--text-accent)",
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>Full withdrawal — entire position will be withdrawn</span>
              </div>
            </div>
          )}
        </Show>

        {/* Step Progress */}
        <Show when={isOperationActive()}>
          <StepIndicator
            currentStep={state.operation.step}
            totalSteps={WITHDRAW_STEPS.length}
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

        {/* Pending Claims Section */}
        <Show when={hasPendingClaims()}>
          <div
            class="space-y-3"
            style={{
              "padding-top": "var(--space-md)",
              "border-top": "1px solid var(--border-glass)",
            }}
          >
            <div class="flex items-center gap-2">
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  "border-radius": "50%",
                  background: "var(--status-success)",
                  animation: "pulse 2s infinite",
                }}
              />
              <h4 class="text-sm font-medium">Pending Claims</h4>
            </div>
            <p class="text-xs text-muted-foreground">
              These withdrawals have completed on L1 and are ready to claim on L2.
            </p>
            <For each={pendingClaims()}>
              {(position) => (
                <div
                  class="input-wrapper"
                  style={{
                    "justify-content": "space-between",
                  }}
                >
                  <div class="space-y-1" style={{ padding: "0 var(--space-sm)" }}>
                    <p class="text-sm font-medium">{position.sharesFormatted}</p>
                    <p class="text-xs text-muted-foreground font-mono">
                      {position.intentId.slice(0, 14)}...
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isProcessing()}
                    onClick={() => handleClaim(position.intentId)}
                    style={{ "margin-right": "var(--space-sm)" }}
                  >
                    <Show when={isClaimActive()} fallback="Claim tokens">
                      Claiming...
                    </Show>
                  </Button>
                </div>
              )}
            </For>
          </div>
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
