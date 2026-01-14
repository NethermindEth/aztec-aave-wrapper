/**
 * Loading State Components
 *
 * Reusable skeleton loading components for async operations.
 * These components provide visual feedback during data fetching
 * and integrate with SolidJS Suspense boundaries.
 */

import type { Component } from "solid-js";
import { Index } from "solid-js";
import { Skeleton } from "./ui/skeleton";
import { Card, CardContent, CardHeader } from "./ui/card";

/**
 * Props for LoadingState components
 */
export interface LoadingStateProps {
  /** Optional CSS class for the container */
  class?: string;
}

/**
 * Generic card skeleton for loading states
 * Matches the dimensions of Card-based components
 */
export const CardSkeleton: Component<LoadingStateProps> = (props) => {
  return (
    <Card class={props.class}>
      <CardHeader class="pb-2">
        <Skeleton class="h-5 w-24" />
      </CardHeader>
      <CardContent>
        <div class="space-y-3">
          <Skeleton class="h-4 w-full" />
          <Skeleton class="h-4 w-3/4" />
        </div>
      </CardContent>
    </Card>
  );
};

/**
 * Wallet info loading skeleton
 * Matches WalletInfo component dimensions
 */
export const WalletSkeleton: Component<LoadingStateProps> = (props) => {
  return (
    <Card class={props.class}>
      <CardHeader class="pb-2">
        <Skeleton class="h-5 w-16" />
      </CardHeader>
      <CardContent>
        <div class="space-y-4">
          <div class="space-y-2">
            <div class="flex justify-between">
              <Skeleton class="h-4 w-20" />
              <Skeleton class="h-4 w-28" />
            </div>
            <div class="flex justify-between">
              <Skeleton class="h-4 w-20" />
              <Skeleton class="h-4 w-28" />
            </div>
          </div>
          <div class="border-t pt-4 space-y-2">
            <div class="flex justify-between">
              <Skeleton class="h-4 w-24" />
              <Skeleton class="h-4 w-20" />
            </div>
            <div class="flex justify-between">
              <Skeleton class="h-4 w-24" />
              <Skeleton class="h-4 w-20" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

/**
 * Connection status bar loading skeleton
 * Matches ConnectionStatusBar component dimensions
 */
export const ConnectionStatusSkeleton: Component<LoadingStateProps> = (props) => {
  return (
    <Card class={props.class}>
      <CardContent class="py-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-4">
            <div class="flex items-center gap-2">
              <Skeleton class="h-3 w-3 rounded-full" />
              <Skeleton class="h-4 w-20" />
            </div>
            <div class="flex items-center gap-2">
              <Skeleton class="h-3 w-3 rounded-full" />
              <Skeleton class="h-4 w-20" />
            </div>
          </div>
          <Skeleton class="h-4 w-24" />
        </div>
      </CardContent>
    </Card>
  );
};

/**
 * Contract deployment loading skeleton
 * Matches ContractDeployment component dimensions
 */
export const ContractDeploymentSkeleton: Component<LoadingStateProps> = (props) => {
  return (
    <Card class={props.class}>
      <CardHeader class="pb-2">
        <Skeleton class="h-5 w-36" />
      </CardHeader>
      <CardContent>
        <div class="space-y-3">
          <div class="flex justify-between">
            <Skeleton class="h-4 w-24" />
            <Skeleton class="h-4 w-32" />
          </div>
          <div class="flex justify-between">
            <Skeleton class="h-4 w-28" />
            <Skeleton class="h-4 w-32" />
          </div>
          <Skeleton class="h-9 w-full mt-4" />
        </div>
      </CardContent>
    </Card>
  );
};

/**
 * Operation tabs loading skeleton
 * Matches OperationTabs component dimensions
 */
export const OperationTabsSkeleton: Component<LoadingStateProps> = (props) => {
  return (
    <Card class={props.class}>
      <CardHeader class="pb-2">
        <div class="flex gap-2">
          <Skeleton class="h-9 w-24" />
          <Skeleton class="h-9 w-24" />
        </div>
      </CardHeader>
      <CardContent>
        <div class="space-y-4">
          <div class="space-y-2">
            <Skeleton class="h-4 w-16" />
            <Skeleton class="h-10 w-full" />
          </div>
          <div class="space-y-2">
            <Skeleton class="h-4 w-20" />
            <Skeleton class="h-10 w-full" />
          </div>
          <Skeleton class="h-10 w-full" />
        </div>
      </CardContent>
    </Card>
  );
};

/**
 * Position card loading skeleton
 * Matches PositionCard component dimensions
 */
export const PositionCardSkeleton: Component<LoadingStateProps> = (props) => {
  return (
    <Card class={props.class}>
      <CardContent class="py-4">
        <div class="flex items-center justify-between">
          <div class="space-y-2">
            <Skeleton class="h-4 w-32" />
            <Skeleton class="h-5 w-24" />
          </div>
          <div class="flex items-center gap-3">
            <Skeleton class="h-6 w-20 rounded-full" />
            <Skeleton class="h-9 w-20" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

/**
 * Positions list loading skeleton
 * Shows multiple position card skeletons
 */
export const PositionsListSkeleton: Component<LoadingStateProps & { count?: number }> = (props) => {
  const count = props.count ?? 2;
  const items = () => Array.from({ length: count }, (_, i) => i);

  return (
    <div class={`space-y-4 ${props.class ?? ""}`}>
      <Index each={items()}>
        {() => <PositionCardSkeleton />}
      </Index>
    </div>
  );
};

/**
 * Log viewer loading skeleton
 * Matches LogViewer component dimensions
 */
export const LogViewerSkeleton: Component<LoadingStateProps> = (props) => {
  return (
    <Card class={props.class}>
      <CardHeader class="pb-2">
        <Skeleton class="h-5 w-28" />
      </CardHeader>
      <CardContent>
        <div class="space-y-2">
          <Skeleton class="h-4 w-full" />
          <Skeleton class="h-4 w-5/6" />
          <Skeleton class="h-4 w-4/5" />
        </div>
      </CardContent>
    </Card>
  );
};

/**
 * Full page loading state
 * Used as Suspense fallback for lazy-loaded routes or major sections
 */
export const PageLoadingSkeleton: Component<LoadingStateProps> = (props) => {
  return (
    <div class={`space-y-6 ${props.class ?? ""}`}>
      <ConnectionStatusSkeleton />
      <WalletSkeleton />
      <ContractDeploymentSkeleton />
      <OperationTabsSkeleton />
      <PositionsListSkeleton count={2} />
      <LogViewerSkeleton />
    </div>
  );
};

/**
 * Simple inline loading indicator
 * For smaller loading states within components
 */
export const InlineLoader: Component<{ text?: string }> = (props) => {
  return (
    <div class="flex items-center gap-2 text-muted-foreground">
      <div class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      <span class="text-sm">{props.text ?? "Loading..."}</span>
    </div>
  );
};
