/**
 * Error Boundary Component
 *
 * Catches JavaScript errors in child components and displays a fallback UI.
 * Uses SolidJS ErrorBoundary primitive for graceful error handling.
 *
 * Note: ErrorBoundary catches errors during rendering, in lifecycle methods,
 * and in constructors of the whole tree below them. It does NOT catch:
 * - Event handler errors
 * - Async errors (setTimeout, promises)
 * - Server-side rendering errors
 */

import { type JSX, type ParentComponent, ErrorBoundary as SolidErrorBoundary } from "solid-js";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

export interface ErrorFallbackProps {
  error: unknown;
  reset: () => void;
}

/**
 * Safely extracts error message from any error type
 */
const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "An unknown error occurred";
};

/**
 * Default error fallback UI component
 */
const ErrorFallback = (props: ErrorFallbackProps) => {
  console.error("[ErrorBoundary] Caught error:", props.error);

  return (
    <Card class="border-destructive bg-destructive/10">
      <CardHeader>
        <CardTitle class="text-destructive">Something went wrong</CardTitle>
        <CardDescription>An error occurred while rendering this component.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="bg-muted p-3 rounded-md">
          <p class="text-sm font-mono text-destructive break-all">{getErrorMessage(props.error)}</p>
        </div>
        <Button variant="outline" onClick={props.reset} class="w-full">
          Try Again
        </Button>
      </CardContent>
    </Card>
  );
};

export interface ErrorBoundaryProps {
  /**
   * Optional custom fallback component
   * If not provided, uses the default ErrorFallback
   */
  fallback?: (error: unknown, reset: () => void) => JSX.Element;
}

/**
 * Error Boundary wrapper component
 *
 * Wraps children in SolidJS ErrorBoundary to catch and handle errors gracefully.
 * Provides a retry mechanism to attempt re-rendering after an error.
 */
export const ErrorBoundary: ParentComponent<ErrorBoundaryProps> = (props) => {
  return (
    <SolidErrorBoundary
      fallback={(error, reset) => {
        if (props.fallback) {
          return props.fallback(error, reset);
        }
        return <ErrorFallback error={error} reset={reset} />;
      }}
    >
      {props.children}
    </SolidErrorBoundary>
  );
};

/**
 * Minimal error fallback for smaller components
 */
export const MinimalErrorFallback = (props: ErrorFallbackProps) => {
  console.error("[ErrorBoundary] Caught error:", props.error);

  return (
    <div class="p-4 border border-destructive rounded-md bg-destructive/10">
      <p class="text-sm text-destructive mb-2">Error: {getErrorMessage(props.error)}</p>
      <Button variant="ghost" size="sm" onClick={props.reset}>
        Retry
      </Button>
    </div>
  );
};
