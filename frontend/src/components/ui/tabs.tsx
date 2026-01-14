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
    <div
      role="tablist"
      class={cn(
        "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
        local.class
      )}
      {...others}
    >
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
      class={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        isSelected()
          ? "bg-background text-foreground shadow-sm"
          : "hover:bg-background/50 hover:text-foreground",
        local.class
      )}
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
      class={cn(
        "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        !isSelected() && "hidden",
        local.class
      )}
      {...others}
    >
      {local.children}
    </div>
  );
}
