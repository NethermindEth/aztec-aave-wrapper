/**
 * Operation step labels and status types
 *
 * Defines the various operation states and step configurations
 * for deposit and withdrawal flows.
 */

// =============================================================================
// Operation Status Types
// =============================================================================

/**
 * Status of the current operation
 */
export type OperationStatus = "pending" | "success" | "error";

/**
 * Type of operation being performed
 */
export type OperationType = "idle" | "deposit" | "withdraw";

// =============================================================================
// Step Configuration Types
// =============================================================================

/**
 * Configuration for a single operation step
 */
export interface StepConfig {
  /** Unique identifier for the step */
  id: string;
  /** Display label for the step */
  label: string;
  /** Optional description of what the step does */
  description?: string;
}

/**
 * Deposit flow steps
 */
export type DepositStep =
  | "approve"
  | "request"
  | "confirm_l2"
  | "execute_l1"
  | "finalize";

/**
 * Withdrawal flow steps
 */
export type WithdrawStep =
  | "request"
  | "confirm_l2"
  | "execute_l1"
  | "finalize";

/**
 * Deposit step configurations
 */
export const DEPOSIT_STEPS: Record<DepositStep, StepConfig> = {
  approve: {
    id: "approve",
    label: "Approve USDC",
    description: "Approve token spending on L1",
  },
  request: {
    id: "request",
    label: "Request Deposit",
    description: "Create deposit intent on L2",
  },
  confirm_l2: {
    id: "confirm_l2",
    label: "Confirm L2 Transaction",
    description: "Wait for L2 transaction confirmation",
  },
  execute_l1: {
    id: "execute_l1",
    label: "Execute on L1",
    description: "Execute deposit on Aave via L1 portal",
  },
  finalize: {
    id: "finalize",
    label: "Finalize Deposit",
    description: "Finalize deposit and receive position receipt",
  },
};

/**
 * Withdrawal step configurations
 */
export const WITHDRAW_STEPS: Record<WithdrawStep, StepConfig> = {
  request: {
    id: "request",
    label: "Request Withdrawal",
    description: "Create withdrawal intent on L2",
  },
  confirm_l2: {
    id: "confirm_l2",
    label: "Confirm L2 Transaction",
    description: "Wait for L2 transaction confirmation",
  },
  execute_l1: {
    id: "execute_l1",
    label: "Execute on L1",
    description: "Execute withdrawal from Aave via L1 portal",
  },
  finalize: {
    id: "finalize",
    label: "Finalize Withdrawal",
    description: "Finalize withdrawal and receive tokens",
  },
};

/**
 * Get the total number of steps for a deposit operation
 */
export function getDepositStepCount(): number {
  return Object.keys(DEPOSIT_STEPS).length;
}

/**
 * Get the total number of steps for a withdraw operation
 */
export function getWithdrawStepCount(): number {
  return Object.keys(WITHDRAW_STEPS).length;
}

/**
 * Get step index (1-based) for deposit step
 */
export function getDepositStepIndex(step: DepositStep): number {
  const steps: DepositStep[] = [
    "approve",
    "request",
    "confirm_l2",
    "execute_l1",
    "finalize",
  ];
  return steps.indexOf(step) + 1;
}

/**
 * Get step index (1-based) for withdraw step
 */
export function getWithdrawStepIndex(step: WithdrawStep): number {
  const steps: WithdrawStep[] = [
    "request",
    "confirm_l2",
    "execute_l1",
    "finalize",
  ];
  return steps.indexOf(step) + 1;
}
