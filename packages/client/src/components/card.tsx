import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

type Div = HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: Div) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card text-card-foreground shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: Div) {
  return <div className={cn("flex flex-col gap-1 p-6", className)} {...props} />;
}

export function CardTitle({ className, ...props }: Div) {
  return <div className={cn("font-semibold leading-none tracking-tight", className)} {...props} />;
}

export function CardContent({ className, ...props }: Div) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}
