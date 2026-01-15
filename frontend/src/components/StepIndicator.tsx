/**
 * StepIndicator Component
 *
 * Displays current step progress with labels, descriptions, and time estimates
 * using the Progress component.
 * Used for multi-step flows like deposit (6 steps) and withdraw (4 steps).
 */

import { createMemo, Show } from "solid-js";
import { Progress } from "~/components/ui/progress";

/**
 * Configuration for a single step in a multi-step flow
 */
export interface StepConfig {
  /** Display label for the step */
  label: string;
  /** Detailed description of what the step does */
  description: string;
  /** Estimated time in seconds for this step to complete */
  estimatedSeconds: number;
}

/**
 * Props for StepIndicator component
 */
export interface StepIndicatorProps {
  /** Current step number (1-indexed) */
  currentStep: number;
  /** Total number of steps in the flow */
  totalSteps: number;
  /** Label describing the current step */
  stepLabel: string;
  /** Optional: Detailed description of what the current step does */
  description?: string;
  /** Optional: Estimated seconds remaining for current step */
  estimatedSecondsRemaining?: number;
  /** Optional: CSS class for the container */
  class?: string;
}

/**
 * Format seconds into a human-readable time string
 * @param seconds Total seconds remaining
 * @returns Formatted string like "~2 min" or "~30 sec"
 */
function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) return "";
  if (seconds < 60) return `~${Math.ceil(seconds)} sec`;
  const minutes = Math.ceil(seconds / 60);
  return `~${minutes} min`;
}

/**
 * StepIndicator renders a progress bar with step information.
 *
 * Features:
 * - Visual progress bar showing completion percentage
 * - Step counter (e.g., "Step 2 of 6")
 * - Current step label for context
 * - Optional detailed description of current step
 * - Optional estimated time remaining
 * - Handles edge cases (step 0, step > total)
 *
 * @example
 * ```tsx
 * // Deposit flow with description and time estimate
 * <StepIndicator
 *   currentStep={2}
 *   totalSteps={6}
 *   stepLabel="Requesting deposit"
 *   description="Creating a private intent on L2 and sending message to L1"
 *   estimatedSecondsRemaining={30}
 * />
 *
 * // Withdraw flow (basic)
 * <StepIndicator
 *   currentStep={1}
 *   totalSteps={4}
 *   stepLabel="Requesting withdrawal"
 * />
 * ```
 */
export function StepIndicator(props: StepIndicatorProps) {
  // Ensure step values are within valid bounds
  const normalizedStep = () => Math.max(0, Math.min(props.currentStep, props.totalSteps));

  const normalizedTotal = () => Math.max(1, props.totalSteps);

  const percentage = () => (normalizedStep() / normalizedTotal()) * 100;

  const timeRemaining = createMemo(() => {
    if (props.estimatedSecondsRemaining === undefined) return "";
    return formatTimeRemaining(props.estimatedSecondsRemaining);
  });

  return (
    <div class={`space-y-2 ${props.class ?? ""}`}>
      <div class="flex justify-between text-sm">
        <span>
          Step {normalizedStep()} of {normalizedTotal()}
        </span>
        <span class="text-muted-foreground">{props.stepLabel}</span>
      </div>
      <Progress value={percentage()} />
      <Show when={props.description || timeRemaining()}>
        <div class="flex justify-between text-xs text-muted-foreground">
          <Show when={props.description}>
            <span>{props.description}</span>
          </Show>
          <Show when={!props.description}>
            <span />
          </Show>
          <Show when={timeRemaining()}>
            <span>{timeRemaining()}</span>
          </Show>
        </div>
      </Show>
    </div>
  );
}
