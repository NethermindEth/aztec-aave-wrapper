import { type JSX, splitProps } from "solid-js";
import { cn } from "~/lib/utils";

export type AlertVariant = "default" | "destructive" | "success" | "warning";

export interface AlertProps extends JSX.HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
}

const alertVariants = {
  base: "relative w-full rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground",
  variant: {
    default: "bg-background text-foreground",
    destructive:
      "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive",
    success:
      "border-green-500/50 text-green-700 dark:text-green-400 [&>svg]:text-green-600",
    warning:
      "border-yellow-500/50 text-yellow-700 dark:text-yellow-400 [&>svg]:text-yellow-600",
  },
};

export function Alert(props: AlertProps) {
  const [local, others] = splitProps(props, ["variant", "class", "children"]);

  return (
    <div
      role="alert"
      class={cn(
        alertVariants.base,
        alertVariants.variant[local.variant ?? "default"],
        local.class
      )}
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
    <h5
      class={cn("mb-1 font-medium leading-none tracking-tight", local.class)}
      {...others}
    >
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
