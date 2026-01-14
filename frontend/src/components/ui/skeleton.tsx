import { type JSX, splitProps } from "solid-js";
import { cn } from "~/lib/utils";

export interface SkeletonProps extends JSX.HTMLAttributes<HTMLDivElement> {}

export function Skeleton(props: SkeletonProps) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <div
      class={cn("animate-pulse rounded-md bg-muted", local.class)}
      {...others}
    />
  );
}
