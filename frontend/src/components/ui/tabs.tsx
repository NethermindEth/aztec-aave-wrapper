import {
  type Accessor,
  createContext,
  createSignal,
  type JSX,
  splitProps,
  useContext,
} from "solid-js";
import { cn } from "~/lib/utils";

interface TabsContextValue {
  value: Accessor<string>;
  setValue: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue>();

function useTabsContext() {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error("Tabs components must be used within a Tabs provider");
  }
  return context;
}

export interface TabsProps extends JSX.HTMLAttributes<HTMLDivElement> {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
}

export function Tabs(props: TabsProps) {
  const [local, others] = splitProps(props, [
    "defaultValue",
    "value",
    "onValueChange",
    "class",
    "children",
  ]);

  const [internalValue, setInternalValue] = createSignal(local.defaultValue ?? "");

  const value = () => local.value ?? internalValue();
  const setValue = (newValue: string) => {
    setInternalValue(newValue);
    local.onValueChange?.(newValue);
  };

  return (
    <TabsContext.Provider value={{ value, setValue }}>
      <div class={cn("w-full", local.class)} {...others}>
        {local.children}
      </div>
    </TabsContext.Provider>
  );
}

export interface TabsListProps extends JSX.HTMLAttributes<HTMLDivElement> {}

export function TabsList(props: TabsListProps) {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <div role="tablist" class={cn("tab-navigation", local.class)} {...others}>
      {local.children}
    </div>
  );
}

export interface TabsTriggerProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

export function TabsTrigger(props: TabsTriggerProps) {
  const [local, others] = splitProps(props, ["value", "class", "children"]);
  const context = useTabsContext();

  const isSelected = () => context.value() === local.value;

  return (
    <button
      role="tab"
      type="button"
      aria-selected={isSelected()}
      tabIndex={isSelected() ? 0 : -1}
      class={cn("tab-button", isSelected() && "active", local.class)}
      onClick={() => context.setValue(local.value)}
      {...others}
    >
      {local.children}
    </button>
  );
}

export interface TabsContentProps extends JSX.HTMLAttributes<HTMLDivElement> {
  value: string;
}

export function TabsContent(props: TabsContentProps) {
  const [local, others] = splitProps(props, ["value", "class", "children"]);
  const context = useTabsContext();

  const isSelected = () => context.value() === local.value;

  return (
    <div
      role="tabpanel"
      hidden={!isSelected()}
      tabIndex={0}
      class={cn("tab-panel", !isSelected() && "hidden", local.class)}
      {...others}
    >
      {local.children}
    </div>
  );
}
