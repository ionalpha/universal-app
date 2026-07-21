import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cspDirectives,
  devCsp,
  hardenedHeaders,
  serializeCsp,
  webCsp,
  webHeadersFile,
} from "./csp.mjs";

// Keeps the Tauri webview's security posture from quietly regressing.
//
// This exists because the regression is always silent. Nothing fails when
// `security.csp` goes back to null, when someone pastes `core:default` into a
// capability to unblock an afternoon, or when 'unsafe-eval' gets added to make
// a library work. The app keeps running; the attack surface just grows. Four of
// the six Tauri starters surveyed for this template shipped `csp: null`, and
// none of them shipped anything that would have told them.
//
// Every rule below fails closed: an unrecognised directive, an ungranted
// permission and an unlisted capability file are all errors, so widening the
// surface takes an edit here and shows up in review as one.

// SECURITY_CHECK_ROOT exists so the regression test can point the check at a
// deliberately tampered copy of the config; every real invocation checks the
// repo itself.
const repoRoot = process.env.SECURITY_CHECK_ROOT
  ? resolve(process.env.SECURITY_CHECK_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const crateDir = join(repoRoot, "apps", "shell", "src-tauri");
const configPath = join(crateDir, "tauri.conf.json");
const capabilitiesDir = join(crateDir, "capabilities");

// Plugin permissions the frontend is allowed to hold over IPC. Empty on
// purpose: the app's own commands live in commands.rs and are not brokered by
// the ACL, so the frontend currently needs nothing from any plugin. Adding an
// entry here is the moment to ask what a compromised renderer could do with it.
const ALLOWED_PERMISSIONS = new Set();

// Sources that must never appear in a directive that can execute code or open a
// connection. `*` and bare schemes are the two ways a policy gets neutered
// while still looking like a policy.
const NEVER = ["*", "'unsafe-eval'", "http:", "https:", "ws:", "wss:", "data:"];

const errors = [];
const fail = (msg) => errors.push(msg);

/** "a 'self'; b 'none'" -> { a: ["'self'"], b: ["'none'"] } */
function parseCsp(policy) {
  const map = {};
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/).filter(Boolean);
    if (name) map[name] = sources;
  }
  return map;
}

const config = JSON.parse(readFileSync(configPath, "utf8"));
const security = config.app?.security ?? {};

// --- Content Security Policy -------------------------------------------------

if (typeof security.csp !== "string" || security.csp.trim() === "") {
  fail(
    "app.security.csp is null or empty. A webview with no CSP will load and execute\n" +
      "    script from anywhere, with the IPC bridge to the Rust core in reach.",
  );
} else {
  const actual = parseCsp(security.csp);
  const expected = cspDirectives({ dev: false });

  // Directive-for-directive against csp.mjs. The prod policy is written out in
  // tauri.conf.json so a reviewer can read it without running anything; this is
  // what stops the two copies drifting.
  for (const [name, sources] of Object.entries(expected)) {
    const got = actual[name];
    if (!got) {
      fail(`app.security.csp is missing "${name} ${sources.join(" ")}".`);
      continue;
    }
    // connect-src is the one directive an app is expected to extend, with the
    // API origins it actually talks to. Everything else must match exactly.
    const extendable = name === "connect-src";
    const missing = sources.filter((s) => !got.includes(s));
    if (missing.length > 0) fail(`app.security.csp "${name}" is missing: ${missing.join(" ")}`);
    if (!extendable) {
      const extra = got.filter((s) => !sources.includes(s));
      if (extra.length > 0) {
        fail(
          `app.security.csp "${name}" has sources csp.mjs does not declare: ${extra.join(" ")}\n` +
            "    Widen cspDirectives() in scripts/csp.mjs instead, so dev enforces the same rule.",
        );
      }
    }
  }

  for (const [name, sources] of Object.entries(actual)) {
    if (!(name in expected)) {
      fail(`app.security.csp declares "${name}", which scripts/csp.mjs does not know about.`);
    }
    for (const bad of sources.filter((s) => NEVER.includes(s))) {
      // data: is legitimate for images and fonts; it is only a hole in the
      // directives that fetch or execute.
      if (bad === "data:" && (name === "img-src" || name === "font-src")) continue;
      fail(`app.security.csp "${name}" allows ${bad}, which defeats the directive.`);
    }
  }

  if ((actual["script-src"] ?? []).includes("'unsafe-inline'")) {
    fail(
      "app.security.csp allows 'unsafe-inline' script. Tauri appends a nonce or hash to\n" +
        "    script-src for the built assets, so the production policy never needs it.",
    );
  }
}

// The dev policy is generated, so the check is that generation cannot produce
// something loose: a real port plan must come out with no wildcards.
const sampleDevCsp = devCsp({
  apiUrl: "http://localhost:10001",
  shellPort: 10002,
  hmrPort: 10003,
  host: "192.168.1.10",
});
for (const [name, sources] of Object.entries(parseCsp(sampleDevCsp))) {
  for (const bad of sources.filter((s) => NEVER.includes(s))) {
    if (bad === "data:" && (name === "img-src" || name === "font-src")) continue;
    fail(`the generated dev CSP allows ${bad} in "${name}" (scripts/csp.mjs).`);
  }
}

// --- The browser target ------------------------------------------------------

// The web app is the same frontend in a strictly worse threat model: real
// cross-origin pages, real extensions, a real URL bar. It shipped with no
// policy at all while the desktop app had one, which is exactly backwards.
for (const [label, policy] of [
  ["web (production)", webCsp({ apiUrl: "https://api.example.com" })],
  ["web (dev)", webCsp({ apiUrl: "http://localhost:10001", dev: true, port: 10002 })],
]) {
  const parsed = parseCsp(policy);
  for (const [name, sources] of Object.entries(cspDirectives({ ipc: false }))) {
    if (!parsed[name]) fail(`the ${label} CSP is missing "${name} ${sources.join(" ")}".`);
  }
  for (const [name, sources] of Object.entries(parsed)) {
    for (const bad of sources.filter((s) => NEVER.includes(s))) {
      if (bad === "data:" && (name === "img-src" || name === "font-src")) continue;
      fail(`the ${label} CSP allows ${bad} in "${name}" (scripts/csp.mjs).`);
    }
  }
  // The browser build talks to no Rust core, so IPC sources there would be
  // noise that reads like a grant.
  for (const ipcSource of ["ipc:", "http://ipc.localhost"]) {
    if ((parsed["connect-src"] ?? []).includes(ipcSource)) {
      fail(`the ${label} CSP lists ${ipcSource}, which only the Tauri shell can use.`);
    }
  }
}

// A static SPA has no server of its own, so the production policy ships as a
// file. If a build is present, it has to match what csp.mjs would emit now -
// otherwise the deployed headers are whatever they were the last time someone
// happened to build.
const webHeadersPath = join(repoRoot, "apps", "web", "dist", "_headers");
if (existsSync(webHeadersPath)) {
  const onDisk = readFileSync(webHeadersPath, "utf8");
  if (!onDisk.includes("Content-Security-Policy:")) {
    fail("apps/web/dist/_headers exists but carries no Content-Security-Policy.");
  }
  for (const header of ["Strict-Transport-Security", "X-Content-Type-Options", "Referrer-Policy"]) {
    if (!onDisk.includes(`${header}:`)) {
      fail(`apps/web/dist/_headers is missing ${header}. Rebuild the web app.`);
    }
  }
}

// --- Protocol response headers -----------------------------------------------

// Same drift rule as the CSP: the production values are written out in
// tauri.conf.json for reviewability, and this asserts they still match
// hardenedHeaders() - which the shell dev server also sends, so a value that
// breaks a request (COEP is the candidate) breaks in dev first, not in a
// release build.
const expectedHeaders = hardenedHeaders();
const actualHeaders = security.headers ?? {};
for (const [name, value] of Object.entries(expectedHeaders)) {
  if (actualHeaders[name] !== value) {
    fail(
      `app.security.headers "${name}" is ${JSON.stringify(actualHeaders[name])}, expected\n` +
        `    ${JSON.stringify(value)}. Edit hardenedHeaders() in scripts/csp.mjs instead, so the\n` +
        "    dev server and the web _headers file change with it.",
    );
  }
}
for (const name of Object.keys(actualHeaders)) {
  if (!(name in expectedHeaders)) {
    fail(`app.security.headers sets "${name}", which scripts/csp.mjs does not declare.`);
  }
}
if (/\*\s*=\s*\(\)/.test(actualHeaders["Permissions-Policy"] ?? "")) {
  fail(
    'app.security.headers Permissions-Policy contains "*=()", which is not valid syntax -\n' +
      "    browsers ignore it silently, so the header protects nothing. Deny by name.",
  );
}

// --- Devtools stay out of release builds -------------------------------------

// Tauri only compiles the inspector into debug builds unless the `devtools`
// cargo feature asks for it everywhere. That is a one-word edit made to debug
// something in a release build, and nothing else would ever notice it.
const cargoToml = readFileSync(join(crateDir, "Cargo.toml"), "utf8");
const tauriDep = cargoToml.match(/^tauri\s*=\s*\{[^}]*\}/m)?.[0] ?? "";
if (/features\s*=\s*\[[^\]]*"devtools"/.test(tauriDep)) {
  fail(
    'Cargo.toml enables the "devtools" feature on the tauri crate, which compiles the\n' +
      "    web inspector into release builds. Debug builds already have it; remove the\n" +
      "    feature so shipped binaries do not carry an open door into the webview.",
  );
}

// --- Other webview settings --------------------------------------------------

if (security.freezePrototype !== true) {
  fail(
    "app.security.freezePrototype is not true. Without it, anything running in the\n" +
      "    webview can poison Object.prototype and change how the IPC bridge behaves.",
  );
}

if (security.assetProtocol?.enable === true && (security.assetProtocol.scope?.length ?? 0) === 0) {
  fail(
    "app.security.assetProtocol is enabled with an empty scope, which exposes the whole\n" +
      "    filesystem to the webview. Scope it to the directories the app actually reads.",
  );
}

if (security.dangerousDisableAssetCspModification) {
  fail(
    "app.security.dangerousDisableAssetCspModification is set. That turns off the nonce\n" +
      "    and hash injection the strict script-src above depends on.",
  );
}

// --- Vite envPrefix ----------------------------------------------------------

// Vite inlines every environment variable matching envPrefix into the client
// bundle. GHSA-2rcp-jvr4-r259 is this exact failure: `envPrefix: ["VITE_",
// "TAURI_"]`, copied from documentation, shipped TAURI_PRIVATE_KEY - the
// updater signing key - inside the frontend. TAURI_ENV_* is the safe subset:
// Tauri only ever sets build metadata (platform, arch, debug) under it. The
// build output is scanned too (check-bundle-secrets.mjs); this catches the
// config edit before anything is built with it.
const ALLOWED_ENV_PREFIXES = new Set(["VITE_", "TAURI_ENV_*"]);
for (const configFile of ["apps/shell/vite.config.ts", "apps/web/vite.config.ts"]) {
  const source = readFileSync(join(repoRoot, configFile), "utf8");
  const declaration = source.match(/envPrefix\s*:\s*(\[[^\]]*\]|["'`][^"'`]*["'`])/);
  if (!declaration) continue; // Vite's default is VITE_ alone, which is fine.
  const prefixes = (declaration[1].match(/["'`]([^"'`]+)["'`]/g) ?? []).map((s) => s.slice(1, -1));
  for (const prefix of prefixes.filter((p) => !ALLOWED_ENV_PREFIXES.has(p))) {
    fail(
      `${configFile} sets envPrefix "${prefix}". Everything matching envPrefix is inlined\n` +
        '    into the shipped bundle. Only "VITE_" (public by definition) and "TAURI_ENV_*"\n' +
        '    (build metadata) are allowed; a bare "TAURI_" matches TAURI_SIGNING_PRIVATE_KEY,\n' +
        "    which is how GHSA-2rcp-jvr4-r259 shipped an updater signing key to users.",
    );
  }
}

// --- Vite version floor ------------------------------------------------------

// The dev server has a recurring file-read CVE class (CVE-2026-39364 and
// CVE-2026-39363 fixed in 8.0.5, CVE-2025-30208 the year before), and mobile
// dev requires binding it to the LAN. `pnpm audit` catches a *published*
// advisory; this floor catches a downgrade below the known-patched line in the
// window before one is published. Raise it when the next dev-server CVE lands.
const VITE_FLOOR = [8, 0, 5];
for (const app of ["apps/shell", "apps/web"]) {
  // Resolved from the app itself: pnpm does not hoist, and what matters is the
  // version each dev server actually runs, not a root copy.
  const appRequire = createRequire(join(repoRoot, app, "package.json"));
  const viteVersion = JSON.parse(
    readFileSync(appRequire.resolve("vite/package.json"), "utf8"),
  ).version;
  if (compareVersions(viteVersion.split(".").map(Number), VITE_FLOOR) < 0) {
    fail(
      `${app} resolves vite ${viteVersion}, below the ${VITE_FLOOR.join(".")} security floor.\n` +
        "    Versions below it carry known dev-server file-read vulnerabilities\n" +
        "    (CVE-2026-39364/-39363), and mobile dev puts that server on the LAN.\n" +
        "    Do not lower the floor.",
    );
  }
}

/** Lexicographic compare of [major, minor, patch] arrays. */
function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  }
  return 0;
}

// --- Capabilities ------------------------------------------------------------

const capabilityFiles = readdirSync(capabilitiesDir).filter((f) => f.endsWith(".json"));
const declared = security.capabilities ?? [];

if (declared.length === 0) {
  fail(
    "app.security.capabilities is unset, so every file in capabilities/ is enabled\n" +
      "    automatically. List them explicitly: a capability file should not become live\n" +
      "    just by existing on disk.",
  );
}

const identifiers = new Set();

for (const file of capabilityFiles) {
  const where = `capabilities/${file}`;
  const capability = JSON.parse(readFileSync(join(capabilitiesDir, file), "utf8"));
  identifiers.add(capability.identifier);

  if (!declared.includes(capability.identifier)) {
    fail(`${where} declares "${capability.identifier}", which app.security.capabilities omits.`);
  }

  const windows = capability.windows ?? [];
  if (windows.length === 0) {
    fail(`${where} names no windows, so it applies to all of them. List them.`);
  }
  if (windows.includes("*")) {
    fail(`${where} targets "*". Grant per window, or a new window inherits everything.`);
  }

  for (const permission of capability.permissions ?? []) {
    const id = typeof permission === "string" ? permission : permission.identifier;
    if (!ALLOWED_PERMISSIONS.has(id)) {
      fail(
        `${where} grants "${id}", which is not in ALLOWED_PERMISSIONS.\n` +
          "    If the frontend genuinely calls it, add it to scripts/check-security.mjs in the\n" +
          "    same commit. Prefer a scoped permission (allow-open-path with a scope) over a\n" +
          "    default set: `core:default` alone is roughly a hundred commands.",
      );
    }
  }
}

for (const id of declared) {
  if (typeof id === "string" && !identifiers.has(id)) {
    fail(`app.security.capabilities lists "${id}", but no file in capabilities/ defines it.`);
  }
}

// --- Report ------------------------------------------------------------------

if (errors.length > 0) {
  console.error(`\n  security: ${errors.length} problem(s) in the Tauri webview configuration\n`);
  for (const error of errors) console.error(`  - ${error}\n`);
  process.exit(1);
}

console.log(
  `✔ security: CSP enforced on shell + web (prod + dev), ${capabilityFiles.length} capability ` +
    `file(s), ${ALLOWED_PERMISSIONS.size} plugin permission(s) granted`,
);

// Printed so the policies the app ships are visible in CI output, not merely
// asserted. A guard that only ever says "ok" teaches nobody what it protects.
if (process.argv.includes("--print")) {
  const show = (label, policy) => console.log(`\n${label}:\n  ${policy.split("; ").join("\n  ")}`);
  show("shell (prod)", serializeCsp(cspDirectives()));
  show("shell (dev, sample plan)", sampleDevCsp);
  show("web (prod, sample API)", webCsp({ apiUrl: "https://api.example.com" }));
  console.log(`\nweb _headers (sample API):\n${webHeadersFile("https://api.example.com")}`);
}
