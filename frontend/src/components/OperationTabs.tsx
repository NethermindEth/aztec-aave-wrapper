/**
 * OperationTabs Component
 *
 * Tabbed interface combining deposit and withdraw flows.
 * Handles tab switching and prevents switching during active operations.
 */

import { createSignal, Show } from "solid-js";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { DepositFlow, type DepositFlowProps } from "./DepositFlow";
import { WithdrawFlow, type WithdrawFlowProps } from "./WithdrawFlow";
import { useApp } from "../store/hooks.js";

/**
 * Tab values for the operation tabs
 */
type OperationTab = "deposit" | "withdraw";

/**
 * Props for OperationTabs component
 */
export interface OperationTabsProps {
  /** Initial tab to display (default: "deposit") */
  defaultTab?: OperationTab;
  /** Callback when deposit is initiated */
  onDeposit?: DepositFlowProps["onDeposit"];
  /** Callback when withdrawal is initiated */
  onWithdraw?: WithdrawFlowProps["onWithdraw"];
  /** Optional: CSS class for the container */
  class?: string;
}

/**
 * OperationTabs renders a tabbed interface with:
 * - Deposit tab containing DepositFlow
 * - Withdraw tab containing WithdrawFlow
 * - Tab switching disabled during active operations
 * - Active tab state preserved
 *
 * @example
 * ```tsx
 * <OperationTabs
 *   defaultTab="deposit"
 *   onDeposit={(amount, deadline) => {
 *     console.log(`Deposit ${amount} with deadline ${deadline}s`);
 *   }}
 *   onWithdraw={(intentId) => {
 *     console.log(`Withdraw position ${intentId}`);
 *   }}
 * />
 * ```
 */
export function OperationTabs(props: OperationTabsProps) {
  const { state } = useApp();

  // Track the active tab
  const [activeTab, setActiveTab] = createSignal<OperationTab>(
    props.defaultTab ?? "deposit"
  );

  // Check if an operation is currently in progress
  const isOperationActive = () => state.operation.type !== "idle";

  // Handle tab change with operation check
  const handleTabChange = (value: string) => {
    // Prevent tab switching during active operations
    if (isOperationActive()) {
      return;
    }
    setActiveTab(value as OperationTab);
  };

  return (
    <Tabs
      value={activeTab()}
      onValueChange={handleTabChange}
      class={props.class}
    >
      <TabsList class="grid w-full grid-cols-2">
        <TabsTrigger
          value="deposit"
          disabled={isOperationActive() && activeTab() !== "deposit"}
        >
          Deposit
        </TabsTrigger>
        <TabsTrigger
          value="withdraw"
          disabled={isOperationActive() && activeTab() !== "withdraw"}
        >
          Withdraw
        </TabsTrigger>
      </TabsList>

      <TabsContent value="deposit">
        <DepositFlow onDeposit={props.onDeposit} />
      </TabsContent>

      <TabsContent value="withdraw">
        <WithdrawFlow onWithdraw={props.onWithdraw} />
      </TabsContent>
    </Tabs>
  );
}
