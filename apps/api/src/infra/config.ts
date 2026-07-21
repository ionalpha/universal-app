// Which origins may talk to this API, resolved from the environment.
//
// Lives in infra because it reads `process.env`; the HTTP layer takes the
// resolved value as an argument so it stays testable without touching the
// environment, and the domain never sees any of it.

/**
 * The origins the native shell serves itself from.
 *
 * These are fixed by Tauri, not by us: the bundled app has no configurable
 * origin, so they are always allowed rather than something a deployment has to
 * remember to list. `tauri://` is macOS, Linux, iOS and Android; Windows cannot
 * register a custom scheme that way and synthesises an http(s) origin instead.
 */
const SHELL_ORIGINS = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"];

/** Matches `http://localhost:1234` and `http://127.0.0.1:1234`, any port. */
const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export interface ApiConfig {
  /** Exact origins allowed in addition to the shell's own. */
  allowedOrigins: string[];
  /** Whether any localhost origin is accepted. Development only. */
  allowLocalhost: boolean;
}

/**
 * Reads `ALLOWED_ORIGINS` (comma-separated) and `NODE_ENV`.
 *
 * Fails closed: in production an empty list is a startup error, not a fallback
 * to `*`. A misconfigured deployment that refuses to boot is a page; one that
 * silently serves every origin is a breach nobody notices.
 *
 * In development the list is normally injected by `scripts/ports.mjs`, which
 * already knows this clone's web and shell origins. Running the API on its own
 * (`pnpm --filter @repo/api dev`) has no such injection, so localhost is
 * accepted there instead of forcing a manual step for a loopback-only server.
 */
export function resolveApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const isProduction = env.NODE_ENV === "production";

  const configured = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (isProduction && configured.length === 0) {
    throw new Error(
      "ALLOWED_ORIGINS is not set. Set it to a comma-separated list of the origins allowed " +
        "to call this API (for example https://app.example.com). Refusing to start rather " +
        "than falling back to allowing every origin.",
    );
  }

  return {
    allowedOrigins: [...SHELL_ORIGINS, ...configured],
    allowLocalhost: !isProduction,
  };
}

/** True if `origin` may call this API. The single rule both CORS and CSRF use. */
export function isAllowedOrigin(config: ApiConfig, origin: string): boolean {
  if (config.allowedOrigins.includes(origin)) return true;
  return config.allowLocalhost && LOCALHOST_ORIGIN.test(origin);
}
