/**
 * OperationTabs Component
 *
 * Tabbed interface combining bridge, deposit, and withdraw flows.
 * Handles tab switching and prevents switching during active operations.
 */

import { createSignal } from "solid-js";
import { useApp } from "../store/hooks.js";
import { BridgeFlow, type BridgeFlowProps } from "./BridgeFlow";
import { DepositFlow, type DepositFlowProps } from "./DepositFlow";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { WithdrawFlow, type WithdrawFlowProps } from "./WithdrawFlow";

/**
 * Tab values for the operation tabs
 */
type OperationTab = "bridge" | "deposit" | "withdraw";

/**
 * Props for OperationTabs component
 */
export interface OperationTabsProps {
  /** Initial tab to display (default: "bridge") */
  defaultTab?: OperationTab;
  /** Callback when bridge is initiated */
  onBridge?: BridgeFlowProps["onBridge"];
  /** Callback when deposit is initiated */
  onDeposit?: DepositFlowProps["onDeposit"];
  /** Callback when withdrawal is initiated */
  onWithdraw?: WithdrawFlowProps["onWithdraw"];
  /** Callback when withdrawal token claim is initiated */
  onClaim?: WithdrawFlowProps["onClaim"];
  /** Optional: CSS class for the container */
  class?: string;
}

/**
 * OperationTabs renders a tabbed interface with:
 * - Bridge tab containing BridgeFlow (first tab - prerequisite for deposits)
 * - Deposit tab containing DepositFlow
 * - Withdraw tab containing WithdrawFlow
 * - Tab switching disabled during active operations
 * - Active tab state preserved
 *
 * @example
 * ```tsx
 * <OperationTabs
 *   defaultTab="bridge"
 *   onBridge={(amount) => {
 *     console.log(`Bridge ${amount} USDC from L1 to L2`);
 *   }}
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
  const [activeTab, setActiveTab] = createSignal<OperationTab>(props.defaultTab ?? "bridge");

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
    <Tabs value={activeTab()} onValueChange={handleTabChange} class={props.class}>
      <TabsList class="grid w-full grid-cols-3">
        <TabsTrigger value="bridge" disabled={isOperationActive() && activeTab() !== "bridge"}>
          Bridge
        </TabsTrigger>
        <TabsTrigger value="deposit" disabled={isOperationActive() && activeTab() !== "deposit"}>
          Deposit
        </TabsTrigger>
        <TabsTrigger value="withdraw" disabled={isOperationActive() && activeTab() !== "withdraw"}>
          Withdraw
        </TabsTrigger>
      </TabsList>

      <TabsContent value="bridge">
        <BridgeFlow onBridge={props.onBridge} />
      </TabsContent>

      <TabsContent value="deposit">
        <DepositFlow onDeposit={props.onDeposit} />
      </TabsContent>

      <TabsContent value="withdraw">
        <WithdrawFlow onWithdraw={props.onWithdraw} onClaim={props.onClaim} />
      </TabsContent>
    </Tabs>
  );
}
