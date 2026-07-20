import { serve } from "@hono/node-server";
import { createHealthService } from "./domain";
import { createRoutes } from "./http";
import { systemClock } from "./infra";

// Wire infrastructure into the domain, mount the HTTP layer, start the server.
const app = createRoutes(createHealthService(systemClock));

export type { AppType } from "./http";

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});
