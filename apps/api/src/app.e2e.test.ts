import type { HealthStatus } from "@repo/types";
import { describe, expect, it } from "vitest";
import { createHealthService } from "./domain";
import { createRoutes } from "./http";
import { systemClock } from "./infra";

// End-to-end over the real wiring: same composition as src/index.ts, minus the
// network listener. `app.fetch` drives a genuine Request through the full
// domain -> infra -> http path, so this exercises the shipped data path — not a
// mock. If the app boots and answers correctly here, `pnpm dev` will too.
const app = createRoutes(createHealthService(systemClock));

describe("api e2e", () => {
  it("GET /health returns a valid @repo/types HealthStatus", async () => {
    const res = await app.fetch(new Request("http://test/health"));
    expect(res.status).toBe(200);

    const body = (await res.json()) as HealthStatus;
    expect(body.status).toBe("ok");
    expect(typeof body.ts).toBe("number");
  });

  it("GET /api/echo echoes a valid message", async () => {
    const res = await app.fetch(new Request("http://test/api/echo?msg=universal"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ echo: "universal" });
  });

  it("GET /api/echo rejects an empty message (validation edge)", async () => {
    const res = await app.fetch(new Request("http://test/api/echo?msg="));
    expect(res.status).toBe(400);
  });
});
