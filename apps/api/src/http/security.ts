import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import { timeout } from "hono/timeout";
import { type ApiConfig, isAllowedOrigin } from "../infra/config";

// The security middleware stack, in one place and in a deliberate order.
//
// This replaced a bare `app.use("*", cors())`, which sets
// `Access-Control-Allow-Origin: *` - every page on the internet allowed to call
// this API from a logged-in user's browser. That is also the shape behind Hono
// advisory GHSA-88fw-hqm2-52qc (fixed in 4.12.25): a wildcard origin combined
// with `credentials: true` reflects any Origin back with
// `Access-Control-Allow-Credentials: true`. We do not send credentials yet, so
// the advisory does not bite today - it bites the moment auth lands, which is
// exactly when nobody will be looking at this file.

/** Bodies larger than this are refused unread. Raise it when a route needs to. */
const MAX_BODY_BYTES = 100 * 1024;

/** A request still running after this is a stuck request, not a slow one. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Mounts the stack. Order is load-bearing:
 *
 * 1. `secureHeaders` first, so its headers are on error responses too.
 * 2. `timeout` and `bodyLimit` next - cheap refusals should happen before any
 *    work, and `bodyLimit` must see the body before a handler reads it.
 * 3. `cors` before `csrf`, because CORS answers the preflight that CSRF's
 *    Origin check depends on.
 */
export function applySecurity(app: Hono, config: ApiConfig): void {
  const allowed = (origin: string) => (isAllowedOrigin(config, origin) ? origin : null);

  app.use(
    "*",
    secureHeaders({
      // Hono's default is `same-origin`, which would block this API's own
      // clients: the web app and the shell are on different origins by
      // construction. `cross-origin` is correct for an API meant to be called
      // cross-origin, and the CORS allowlist below is what does the restricting.
      crossOriginResourcePolicy: "cross-origin",
      // No browser should embed a JSON API in a frame.
      xFrameOptions: "DENY",
      // Only meaningful behind TLS; browsers ignore it over plain http, so it
      // costs nothing in dev and is already correct in production.
      strictTransportSecurity: "max-age=31536000; includeSubDomains",
      referrerPolicy: "no-referrer",
      // The API renders no HTML, so it needs no browser features at all.
      permissionsPolicy: {},
    }),
  );

  app.use("*", timeout(REQUEST_TIMEOUT_MS));
  app.use("*", bodyLimit({ maxSize: MAX_BODY_BYTES }));

  app.use(
    "*",
    cors({
      origin: allowed,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      maxAge: 600,
      // Deliberately false. Turning this on is what makes a mistake in the
      // origin list exploitable, so it should be a considered change made
      // alongside auth, not a default inherited from a template.
      credentials: false,
    }),
  );

  // CORS is not enough on its own: a form post is a "simple request" and is
  // sent without a preflight, so the browser never asks permission. This
  // catches those by checking Origin / Sec-Fetch-Site directly.
  app.use("*", csrf({ origin: (origin) => isAllowedOrigin(config, origin) }));
}
