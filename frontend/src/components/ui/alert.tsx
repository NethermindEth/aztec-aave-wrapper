import { type JSX, splitProps } from "solid-js";
import { cn } from "~/lib/utils";

export type AlertVariant = "default" | "destructive" | "success" | "warning";

export interface AlertProps extends JSX.HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
}

const alertVariants = {
  base: [
    "relative w-full rounded-lg border p-4",
    "[&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px]",
    "[&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4",
    "backdrop-blur-sm transition-colors duration-200",
  ].join(" "),
  variant: {
    default: [
      "bg-[var(--bg-glass)]",
      "border-[var(--border-glass)]",
      "text-foreground",
      "[&>svg]:text-foreground",
    ].join(" "),
    destructive: [
      "bg-[rgba(239,68,68,0.1)]",
      "border-[rgba(239,68,68,0.5)]",
      "text-[var(--status-error)]",
      "[&>svg]:text-[var(--status-error)]",
    ].join(" "),
    success: [
      "bg-[rgba(0,212,170,0.1)]",
      "border-[rgba(0,212,170,0.5)]",
      "text-[var(--status-success)]",
      "[&>svg]:text-[var(--status-success)]",
    ].join(" "),
    warning: [
      "bg-[rgba(245,158,11,0.1)]",
      "border-[rgba(245,158,11,0.5)]",
      "text-[var(--status-warning)]",
      "[&>svg]:text-[var(--status-warning)]",
    ].join(" "),
  },
};

export function Alert(props: AlertProps) {
  const [local, others] = splitProps(props, ["variant", "class", "children"]);

  return (
    <div
      role="alert"
      class={cn(alertVariants.base, alertVariants.variant[local.variant ?? "default"], local.class)}
      {...others}
    >
      {local.children}
    </div>
  );
}

export interface AlertTitleProps extends JSX.HTMLAttributes<HTMLHeadingElement> {}

export function AlertTitle(props: AlertTitleProps) {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <h5 class={cn("mb-1 font-medium leading-none tracking-tight", local.class)} {...others}>
      {local.children}
    </h5>
  );
}

export interface AlertDescriptionProps extends JSX.HTMLAttributes<HTMLParagraphElement> {}

export function AlertDescription(props: AlertDescriptionProps) {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <div class={cn("text-sm [&_p]:leading-relaxed", local.class)} {...others}>
      {local.children}
    </div>
  );
}
