import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Spinner } from "./spinner";

function Wrap({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <Wrap>
      <Spinner />
      <span>{label}</span>
    </Wrap>
  );
}

export function EmptyState({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <Wrap>
      <span className="font-medium text-foreground">{title}</span>
      {description ? <span>{description}</span> : null}
    </Wrap>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
}: {
  title?: ReactNode;
  description?: ReactNode;
}) {
  return (
    <Wrap className="text-destructive">
      <span className="font-medium">{title}</span>
      {description ? <span>{description}</span> : null}
    </Wrap>
  );
}
