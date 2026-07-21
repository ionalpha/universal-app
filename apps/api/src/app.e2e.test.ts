import type { HealthStatus } from "@repo/types";
import { describe, expect, it } from "vitest";
import { createHealthService } from "./domain";
import { createRoutes } from "./http";
import { resolveApiConfig, systemClock } from "./infra";

// End-to-end over the real wiring: same composition as src/index.ts, minus the
// network listener. `app.fetch` drives a genuine Request through the full
// domain -> infra -> http path, so this exercises the shipped data path - not a
// mock. If the app boots and answers correctly here, `pnpm dev` will too.
const ALLOWED = "https://app.example.com";
const app = createRoutes(
  createHealthService(systemClock),
  resolveApiConfig({ NODE_ENV: "production", ALLOWED_ORIGINS: ALLOWED } as NodeJS.ProcessEnv),
);

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

// These are regression tests, not configuration assertions. Each one fails if a
// control is removed, so removing one is a visible act rather than a quiet
// widening. A bare `cors()` with no options answers every one of these with
// `*`.
describe("api security", () => {
  const get = (headers: Record<string, string> = {}) =>
    app.fetch(new Request("http://test/health", { headers }));

  it("allows a listed origin", async () => {
    const res = await get({ Origin: ALLOWED });
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
  });

  it("does not allow an unlisted origin", async () => {
    const res = await get({ Origin: "https://evil.example.com" });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("never answers with a wildcard origin", async () => {
    for (const origin of [ALLOWED, "https://evil.example.com", "null"]) {
      const res = await get({ Origin: origin });
      expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
    }
  });

  it("allows the shell's own origins without them being configured", async () => {
    // The bundled app has no configurable origin, so these must work in a
    // deployment whose ALLOWED_ORIGINS names only the web app.
    for (const origin of ["tauri://localhost", "http://tauri.localhost"]) {
      const res = await get({ Origin: origin });
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    }
  });

  it("rejects localhost origins in production", async () => {
    const res = await get({ Origin: "http://localhost:5173" });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("accepts localhost origins in development", async () => {
    const dev = createRoutes(
      createHealthService(systemClock),
      resolveApiConfig({ NODE_ENV: "development" } as NodeJS.ProcessEnv),
    );
    const res = await dev.fetch(
      new Request("http://test/health", { headers: { Origin: "http://localhost:5173" } }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("refuses to start in production without ALLOWED_ORIGINS", () => {
    expect(() => resolveApiConfig({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(
      /ALLOWED_ORIGINS/,
    );
  });

  it("sets the security headers, with CORP cross-origin so its own clients work", async () => {
    const res = await get();
    // same-origin here (Hono's default) would block the web app and the shell,
    // which are cross-origin by construction.
    expect(res.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("rejects a cross-origin form post (the CSRF path CORS does not cover)", async () => {
    // A simple request: no preflight, so CORS never gets asked.
    const res = await app.fetch(
      new Request("http://test/api/echo", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "https://evil.example.com",
        },
        body: "msg=pwned",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("refuses a body over the limit", async () => {
    const res = await app.fetch(
      new Request("http://test/api/echo", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ALLOWED },
        body: JSON.stringify({ pad: "x".repeat(200 * 1024) }),
      }),
    );
    expect(res.status).toBe(413);
  });
});
