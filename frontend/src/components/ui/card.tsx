import { type JSX, splitProps } from "solid-js";
import { cn } from "~/lib/utils";

export interface CardProps extends JSX.HTMLAttributes<HTMLDivElement> {}

export function Card(props: CardProps) {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <div
      class={cn("rounded-lg border bg-card text-card-foreground shadow-sm", local.class)}
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
