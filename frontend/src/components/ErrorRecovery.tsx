/**
 * ErrorRecovery Component
 *
 * Displays flow errors with user-friendly messages and retry/cancel options.
 * Provides clear error states and recovery actions for operation failures.
 */

import { Show } from "solid-js";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";

/**
 * Map technical error messages to user-friendly descriptions
 */
function getUserFriendlyMessage(error: string): {
  title: string;
  description: string;
  suggestion: string;
} {
  const errorLower = error.toLowerCase();

  // Network/connection errors
  if (errorLower.includes("network") || errorLower.includes("connection")) {
    return {
      title: "Connection Error",
      description: "Unable to connect to the network.",
      suggestion: "Please check your internet connection and try again.",
    };
  }

  // Transaction rejected by user
  if (
    errorLower.includes("rejected") ||
    errorLower.includes("denied") ||
    errorLower.includes("cancelled")
  ) {
    return {
      title: "Transaction Cancelled",
      description: "The transaction was cancelled.",
      suggestion: "You can retry the operation when ready.",
    };
  }

  // Insufficient funds
  if (errorLower.includes("insufficient") || errorLower.includes("balance")) {
    return {
      title: "Insufficient Funds",
      description: "You don't have enough funds for this transaction.",
      suggestion: "Please add more funds to your wallet and try again.",
    };
  }

  // Gas estimation failures
  if (errorLower.includes("gas") || errorLower.includes("estimation")) {
    return {
      title: "Transaction Failed",
      description: "Unable to estimate transaction cost.",
      suggestion: "The transaction may not be valid. Please check your inputs.",
    };
  }

  // Timeout errors
  if (errorLower.includes("timeout") || errorLower.includes("timed out")) {
    return {
      title: "Operation Timed Out",
      description: "The operation took too long to complete.",
      suggestion: "Please try again. If the issue persists, the network may be congested.",
    };
  }

  // Deadline expired
  if (errorLower.includes("deadline") || errorLower.includes("expired")) {
    return {
      title: "Deadline Expired",
      description: "The operation deadline has passed.",
      suggestion: "Please start a new operation with a longer deadline.",
    };
  }

  // Contract/execution errors
  if (errorLower.includes("revert") || errorLower.includes("execution")) {
    return {
      title: "Transaction Failed",
      description: "The transaction could not be completed.",
      suggestion: "Please try again or contact support if the issue persists.",
    };
  }

  // Message/proof errors (cross-chain specific)
  if (errorLower.includes("message") || errorLower.includes("proof")) {
    return {
      title: "Cross-Chain Error",
      description: "There was an issue with the cross-chain message.",
      suggestion: "Please wait a moment and try again. Messages may take time to propagate.",
    };
  }

  // Default fallback
  return {
    title: "Operation Failed",
    description: "An unexpected error occurred.",
    suggestion:
      "Please try again. If the issue persists, the error details may help diagnose the problem.",
  };
}

/**
 * Props for ErrorRecovery component
 */
export interface ErrorRecoveryProps {
  /** The error message to display */
  error: string;
  /** Callback when user clicks retry */
  onRetry?: () => void;
  /** Callback when user clicks cancel/dismiss */
  onCancel?: () => void;
  /** Whether retry is available */
  canRetry?: boolean;
  /** Optional: CSS class for the container */
  class?: string;
  /** Whether to show technical details */
  showDetails?: boolean;
}

/**
 * ErrorRecovery renders a user-friendly error display with:
 * - Clear, non-technical error title
 * - Helpful description and suggestion
 * - Retry and cancel buttons
 * - Optional technical details for debugging
 *
 * @example
 * ```tsx
 * <ErrorRecovery
 *   error="Transaction reverted: insufficient allowance"
 *   onRetry={() => handleRetry()}
 *   onCancel={() => handleCancel()}
 *   canRetry={true}
 * />
 * ```
 */
export function ErrorRecovery(props: ErrorRecoveryProps) {
  const friendlyError = () => getUserFriendlyMessage(props.error);

  return (
    <Alert variant="destructive" class={props.class}>
      <AlertTitle>{friendlyError().title}</AlertTitle>
      <AlertDescription>
        <div class="space-y-3">
          <p>{friendlyError().description}</p>
          <p class="text-sm opacity-80">{friendlyError().suggestion}</p>

          {/* Technical details (collapsible) */}
          <Show when={props.showDetails !== false}>
            <details class="text-xs">
              <summary class="cursor-pointer opacity-70 hover:opacity-100">
                Technical details
              </summary>
              <pre class="mt-2 p-2 bg-black/10 rounded text-xs overflow-x-auto whitespace-pre-wrap break-all">
                {props.error}
              </pre>
            </details>
          </Show>

          {/* Action buttons */}
          <div class="flex gap-2 pt-2">
            <Show when={props.canRetry !== false && props.onRetry}>
              <Button variant="outline" size="sm" onClick={() => props.onRetry?.()} class="flex-1">
                Try Again
              </Button>
            </Show>
            <Show when={props.onCancel}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => props.onCancel?.()}
                class={props.canRetry !== false && props.onRetry ? "" : "flex-1"}
              >
                Dismiss
              </Button>
            </Show>
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}
