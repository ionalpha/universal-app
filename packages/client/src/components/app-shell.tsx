import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/** Page frame with optional header/footer slots. Fills the viewport height. */
export function AppShell({
  header,
  footer,
  children,
  className,
}: {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-dvh flex-col bg-background text-foreground", className)}>
      {header ? <header className="border-b border-border">{header}</header> : null}
      <main className="flex-1">{children}</main>
      {footer ? <footer className="border-t border-border">{footer}</footer> : null}
    </div>
  );
}
