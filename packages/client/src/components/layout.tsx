import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

type Div = HTMLAttributes<HTMLDivElement>;

/** Vertical flex stack. */
export function Stack({ className, ...props }: Div) {
  return <div className={cn("flex flex-col gap-4", className)} {...props} />;
}

/** Horizontal flex row, centered. */
export function HStack({ className, ...props }: Div) {
  return <div className={cn("flex flex-row items-center gap-3", className)} {...props} />;
}

/** Centered, width-capped page container. */
export function Container({ className, ...props }: Div) {
  return <div className={cn("mx-auto w-full max-w-2xl px-4", className)} {...props} />;
}
