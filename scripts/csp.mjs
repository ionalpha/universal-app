// The shell's Content Security Policy, written once and used from three places.
//
// A webview with `csp: null` is a browser with the guard rails removed: any
// injected script can reach any host on the internet, and the IPC bridge to the
// Rust core is sitting right there. This is the file that stops that being the
// default, and the reason it is JavaScript rather than a string in
// tauri.conf.json is that the dev policy has to name ports this clone derives
// at runtime (see ports.mjs), so it cannot be static.
//
// Who reads what:
//   - tauri.conf.json  `app.security.csp`    the bundled app (static, strict)
//   - vite.config.ts   `server.headers`      desktop dev, where Vite serves the
//                                            assets and Tauri never sees them
//   - shell.mjs        `app.security.devCsp` mobile dev, where Tauri proxies the
//                                            dev server through its own protocol
//
// The prod policy lives in tauri.conf.json rather than here on purpose: it is
// the one a reviewer needs to be able to read without running anything, and
// check-security.mjs asserts it still matches the shape below.

// Tauri's bridge to the Rust core. `ipc:` is the custom scheme on macOS, Linux
// and mobile; Windows cannot register a scheme that way and uses a synthesised
// http origin instead. Both are listed because one binary targets all of them.
export const TAURI_IPC = ["ipc:", "http://ipc.localhost"];

// The API origin a build falls back to when VITE_API_URL is unset. It has to
// match the fallback in the frontends' main.tsx: the policy allows exactly the
// origin the bundle will call, and if the two disagree the app ships with its
// own API blocked. Change both, or neither.
export const DEFAULT_API_URL = "http://localhost:8787";

/** Directive map -> policy string. Empty directives are dropped, not emitted blank. */
export function serializeCsp(directives) {
  return Object.entries(directives)
    .filter(([, sources]) => sources.length > 0)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

/**
 * The policy skeleton. Dev and prod share every directive; `dev` only widens
 * the two that Vite's own machinery forces open, and `connect` adds the origins
 * this clone actually talks to.
 *
 * Keeping one skeleton is the point. Two hand-written policies drift, and the
 * drift is always in the same direction: the dev one gets loosened to unblock
 * someone, the prod one is discovered to be broken at release time.
 */
export function cspDirectives({ dev = false, ipc = true, connect = [] } = {}) {
  return {
    "default-src": ["'self'"],
    // Vite's dev server injects the react-refresh preamble as an inline module
    // script and ships CSS as injected <style> tags. Neither exists in a build:
    // Tauri parses the built assets and appends a nonce or hash to these two
    // directives itself, which is why prod can stay at bare 'self'.
    "script-src": dev ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    "style-src": dev ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    "img-src": ["'self'", "data:"],
    "font-src": ["'self'"],
    // The allowlist that matters. 'self' is the app's own origin; the IPC
    // entries are the Rust bridge; everything else is an API this app was
    // deliberately pointed at. The browser build has no Rust core behind it, so
    // it does not get the IPC sources — listing them there would be noise that
    // reads like a grant.
    "connect-src": ["'self'", ...(ipc ? TAURI_IPC : []), ...connect],
    // This app embeds nothing and is embedded by nothing, so the whole class of
    // plugin, iframe and clickjacking attacks is closed rather than narrowed.
    "object-src": ["'none'"],
    "frame-src": ["'none'"],
    "child-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "worker-src": ["'self'"],
    // Without these two, an injected <base> tag reparents every relative URL in
    // the document, and an injected form posts wherever it likes.
    "base-uri": ["'self'"],
    "form-action": ["'none'"],
  };
}

/**
 * The dev policy for a resolved port plan.
 *
 * Named origins, not `http://localhost:*`. The wildcard would be shorter and
 * would quietly permit every other dev server on the machine, including
 * whatever else the developer happens to be running. The caller already knows
 * which ports this clone owns (ports.mjs derived them), so there is nothing to
 * guess at.
 *
 * `host` is TAURI_DEV_HOST: the LAN address a phone loads the dev server from
 * during `pnpm mobile:ios` / `pnpm mobile:android`. On that path the page's
 * origin is the LAN IP rather than localhost, so it has to be listed too or the
 * app boots to a blank screen with only a console warning to explain itself.
 */
export function devCsp({ apiUrl, shellPort, hmrPort, host = process.env.TAURI_DEV_HOST }) {
  const connect = [];

  const api = authorityOf(apiUrl);
  if (api) {
    connect.push(`http://${api}`);
    const [apiHost, apiPort] = [api.split(":")[0], api.split(":")[1]];
    // The API binds the wildcard address, so the same server answers on either
    // spelling and either one can end up in VITE_API_URL.
    if (apiHost === "localhost" && apiPort) connect.push(`http://127.0.0.1:${apiPort}`);
    // Same server, reached over the LAN by a phone.
    if (host && apiPort) connect.push(`http://${host}:${apiPort}`);
  }

  // HMR rides the page's own origin unless a host is set, in which case Vite
  // moves it to its own port. Both are listed so switching to mobile dev does
  // not silently kill hot reload.
  connect.push(`ws://localhost:${shellPort}`, `ws://localhost:${hmrPort}`);

  if (host) {
    connect.push(
      `http://${host}:${shellPort}`,
      `ws://${host}:${shellPort}`,
      `ws://${host}:${hmrPort}`,
    );
  }

  return serializeCsp(cspDirectives({ dev: true, connect }));
}

/**
 * The browser build's policy.
 *
 * Same skeleton as the shell, minus the IPC sources (there is no Rust core
 * behind a browser tab) and plus whatever origin the API is on. The service
 * worker is covered by `worker-src 'self'`, already in the skeleton.
 *
 * The threat model here is strictly worse than the webview's - real
 * cross-origin pages, real extensions, a real URL bar - so the browser target
 * getting a weaker policy than the desktop app would be exactly backwards.
 */
export function webCsp({ apiUrl = DEFAULT_API_URL, dev = false, port } = {}) {
  const connect = [];

  const api = authorityOf(apiUrl);
  if (api) {
    // Keep the scheme the app will actually use. Deriving it (https in prod)
    // would silently disagree with a bundle built against an http API and give
    // a blocked request with no obvious cause.
    connect.push(`${new URL(apiUrl).protocol}//${api}`);
    if (dev) {
      const [apiHost, apiPort] = [api.split(":")[0], api.split(":")[1]];
      if (apiHost === "localhost" && apiPort) connect.push(`http://127.0.0.1:${apiPort}`);
    }
  }

  // Vite serves HMR on the page's own origin for the web target.
  if (dev && port) connect.push(`ws://localhost:${port}`);

  return serializeCsp(cspDirectives({ dev, ipc: false, connect }));
}

/**
 * Non-CSP security headers, shared by every delivery path: the Tauri protocol
 * (`app.security.headers`, guarded by check-security.mjs), the shell's Vite dev
 * server, and the web `_headers` file. One object so a value proven safe in dev
 * (COEP is the one that can break a working fetch) is the value that ships.
 *
 * Permissions-Policy has no "deny everything" token - `*=()` is not valid
 * syntax and browsers ignore it silently, which is worse than no header - so
 * the powerful features are denied by name. Delete an entry to use the feature.
 */
export function hardenedHeaders() {
  return {
    // One browsing context group per window; nothing can hold a handle to it.
    "Cross-Origin-Opener-Policy": "same-origin",
    // Only same-origin or explicitly CORS/CORP-approved resources may load.
    // The API opts in: it serves Cross-Origin-Resource-Policy: cross-origin.
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "Permissions-Policy": [
      "accelerometer",
      "autoplay",
      "bluetooth",
      "camera",
      "display-capture",
      "encrypted-media",
      "fullscreen",
      "geolocation",
      "gyroscope",
      "hid",
      "idle-detection",
      "local-fonts",
      "magnetometer",
      "microphone",
      "midi",
      "payment",
      "picture-in-picture",
      "publickey-credentials-get",
      "screen-wake-lock",
      "serial",
      "usb",
      "web-share",
      "xr-spatial-tracking",
    ]
      .map((feature) => `${feature}=()`)
      .join(", "),
  };
}

/**
 * The production policy as a `_headers` file, the format Netlify and Cloudflare
 * Pages read.
 *
 * A static SPA has no server of its own, so "set these headers" is otherwise a
 * README instruction, and a README instruction is a header nobody sets. This
 * makes the correct thing the default for two common hosts and gives everyone
 * else a file to translate. `pnpm security` checks it was emitted and matches.
 */
export function webHeadersFile(apiUrl = DEFAULT_API_URL) {
  const headers = {
    "Content-Security-Policy": webCsp({ apiUrl }),
    ...hardenedHeaders(),
    // The web-only baseline on top: transport and referrer rules a native
    // window has no use for.
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Referrer-Policy": "no-referrer",
    // X-Frame-Options is redundant with the CSP's frame-ancestors 'none' for
    // any current browser, and kept for the ones that never learned the newer
    // directive. Redundant, not conflicting.
    "X-Frame-Options": "DENY",
  };

  const lines = ["/*", ...Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`)];
  return `${lines.join("\n")}\n`;
}

/** `http://localhost:10352` -> `localhost:10352`, tolerating a malformed value. */
function authorityOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
