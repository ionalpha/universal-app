import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

export interface MountOptions {
  /** Which shell is rendering (web, desktop, ios, android). */
  platform: string;
  /** Base URL of the Hono API. */
  apiUrl: string;
  /** DOM id to mount into. */
  rootId?: string;
}

/**
 * Single mount entrypoint for every shell. Keeps per-app main.tsx down to one
 * call so the createRoot/StrictMode boilerplate is never copy-pasted.
 */
export function mountApp({ platform, apiUrl, rootId = "root" }: MountOptions) {
  const el = document.getElementById(rootId);
  if (!el) throw new Error(`Root element #${rootId} not found`);
  createRoot(el).render(
    <StrictMode>
      <App platform={platform} apiUrl={apiUrl} />
    </StrictMode>,
  );
}
