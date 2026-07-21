import { serve } from "@hono/node-server";
import { createHealthService } from "./domain";
import { createRoutes } from "./http";
import { resolveApiConfig, systemClock } from "./infra";

// Wire infrastructure into the domain, mount the HTTP layer, start the server.
// Config is resolved here, at the composition root, so nothing below it reads
// the environment. In production an unset ALLOWED_ORIGINS throws here and the
// process never starts, which is the intended behaviour.
const config = resolveApiConfig();
const app = createRoutes(createHealthService(systemClock), config);

export type { AppType } from "./http";

// Loopback in dev: the frontends run on this machine, so nothing on the
// network has any business reaching the API. The two exceptions set API_HOST
// themselves: production (a container must bind the wildcard for its edge to
// route to it - NODE_ENV covers that) and on-device mobile dev, where
// scripts/shell.mjs widens the bind so the phone can reach the API and warns
// about what that exposes.
const port = Number(process.env.PORT ?? 8787);
const hostname =
  process.env.API_HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`API listening on http://${info.address}:${info.port}`);
});
