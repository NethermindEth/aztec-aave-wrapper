import { type JSX, splitProps } from "solid-js";
import { cn } from "~/lib/utils";

export interface ProgressProps extends JSX.HTMLAttributes<HTMLDivElement> {
  value?: number;
  max?: number;
}

export function Progress(props: ProgressProps) {
  const [local, others] = splitProps(props, ["value", "max", "class"]);
  const max = () => local.max ?? 100;
  const value = () => Math.min(Math.max(local.value ?? 0, 0), max());
  const percentage = () => (value() / max()) * 100;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max()}
      aria-valuenow={value()}
      class={cn(
        "relative h-4 w-full overflow-hidden rounded-full bg-secondary",
        local.class
      )}
      {...others}
    >
      <div
        class="h-full w-full flex-1 bg-primary transition-all"
        style={{ transform: `translateX(-${100 - percentage()}%)` }}
      />
    </div>
  );
}
