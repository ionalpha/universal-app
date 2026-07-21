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

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});
