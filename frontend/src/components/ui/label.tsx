import { type JSX, splitProps } from "solid-js";
import { cn } from "~/lib/utils";

export interface LabelProps extends JSX.LabelHTMLAttributes<HTMLLabelElement> {}

export function Label(props: LabelProps) {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <label
      class={cn(
        "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        local.class
      )}
      {...others}
    >
      {local.children}
    </label>
  );
}
