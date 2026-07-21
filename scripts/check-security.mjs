import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cspDirectives, devCsp, serializeCsp, webCsp, webHeadersFile } from "./csp.mjs";

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

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
