/**
 * StepIndicator Component
 *
 * Displays current step progress with labels using the Progress component.
 * Used for multi-step flows like deposit (6 steps) and withdraw (4 steps).
 */

import { Progress } from "~/components/ui/progress";

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
  /** Optional: CSS class for the container */
  class?: string;
}

/**
 * StepIndicator renders a progress bar with step information.
 *
 * Features:
 * - Visual progress bar showing completion percentage
 * - Step counter (e.g., "Step 2 of 6")
 * - Current step label for context
 * - Handles edge cases (step 0, step > total)
 *
 * @example
 * ```tsx
 * // Deposit flow
 * <StepIndicator
 *   currentStep={2}
 *   totalSteps={6}
 *   stepLabel="Approving USDC..."
 * />
 *
 * // Withdraw flow
 * <StepIndicator
 *   currentStep={1}
 *   totalSteps={4}
 *   stepLabel="Requesting withdrawal"
 * />
 * ```
 */
export function StepIndicator(props: StepIndicatorProps) {
  // Ensure step values are within valid bounds
  const normalizedStep = () =>
    Math.max(0, Math.min(props.currentStep, props.totalSteps));

  const normalizedTotal = () => Math.max(1, props.totalSteps);

  const percentage = () => (normalizedStep() / normalizedTotal()) * 100;

  return (
    <div class={`space-y-2 ${props.class ?? ""}`}>
      <div class="flex justify-between text-sm">
        <span>
          Step {normalizedStep()} of {normalizedTotal()}
        </span>
        <span class="text-muted-foreground">{props.stepLabel}</span>
      </div>
      <Progress value={percentage()} />
    </div>
  );
}
