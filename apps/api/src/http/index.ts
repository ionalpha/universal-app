import { Hono } from "hono";
import { z } from "zod";
import type { HealthService } from "../domain";
import type { ApiConfig } from "../infra/config";
import { applySecurity } from "./security";

const EchoQuery = z.object({
  msg: z.string().min(1).max(280).default("hello"),
});

/**
 * The HTTP surface. Receives injected domain services and translates
 * HTTP <-> domain. Chained so the type flows to the RPC client.
 */
export function createRoutes(health: HealthService, config: ApiConfig) {
  const app = new Hono();
  applySecurity(app, config);

  return app
    .get("/health", (c) => c.json(health.check()))
    .get("/api/echo", (c) => {
      const parsed = EchoQuery.safeParse({ msg: c.req.query("msg") });
      if (!parsed.success) {
        return c.json({ error: "invalid query" }, 400);
      }
      return c.json({ echo: parsed.data.msg });
    });
}

/** RPC client type (hono/client) derives from this - no codegen. */
export type AppType = ReturnType<typeof createRoutes>;
