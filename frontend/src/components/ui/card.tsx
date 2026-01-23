import { type JSX, splitProps } from "solid-js";
import { cn } from "~/lib/utils";

export type CardVariant = "default" | "glass";

const cardVariants: {
  base: string;
  variant: Record<CardVariant, string>;
} = {
  base: "rounded-lg border text-card-foreground",
  variant: {
    default: "bg-card shadow-sm",
    glass: [
      "bg-[var(--bg-glass)]",
      "backdrop-blur-xl",
      "border-[var(--border-glass)]",
      "transition-all duration-200",
      "relative overflow-hidden",
      "hover:bg-[var(--bg-card-hover)]",
      "hover:border-[var(--border-active)]",
      "hover:shadow-[var(--shadow-glow)]",
      "hover:-translate-y-0.5",
    ].join(" "),
  },
};

export interface CardProps extends JSX.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

export function Card(props: CardProps) {
  const [local, others] = splitProps(props, ["variant", "class", "children"]);

  return (
    <div
      class={cn(cardVariants.base, cardVariants.variant[local.variant ?? "default"], local.class)}
      {...others}
    >
      {local.children}
    </div>
  );
}

export interface CardHeaderProps extends JSX.HTMLAttributes<HTMLDivElement> {}

export function CardHeader(props: CardHeaderProps) {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <div class={cn("flex flex-col space-y-1.5 p-6", local.class)} {...others}>
      {local.children}
    </div>
  );
}

export interface CardTitleProps extends JSX.HTMLAttributes<HTMLHeadingElement> {}

export function CardTitle(props: CardTitleProps) {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <h3 class={cn("text-2xl font-semibold leading-none tracking-tight", local.class)} {...others}>
      {local.children}
    </h3>
  );
}

export interface CardDescriptionProps extends JSX.HTMLAttributes<HTMLParagraphElement> {}

export function CardDescription(props: CardDescriptionProps) {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <p class={cn("text-sm text-muted-foreground", local.class)} {...others}>
      {local.children}
    </p>
  );
}

export interface CardContentProps extends JSX.HTMLAttributes<HTMLDivElement> {}

export function CardContent(props: CardContentProps) {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <div class={cn("p-6 pt-0", local.class)} {...others}>
      {local.children}
    </div>
  );
}

export interface CardFooterProps extends JSX.HTMLAttributes<HTMLDivElement> {}

export function CardFooter(props: CardFooterProps) {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <div class={cn("flex items-center p-6 pt-0", local.class)} {...others}>
      {local.children}
    </div>
  );
}
