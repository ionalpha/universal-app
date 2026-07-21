import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Fails the build if a secret is present in the client output.
//
// This scans what actually ships, not the config that produced it, so it
// catches the leak no matter the mechanism: a widened Vite envPrefix
// (GHSA-2rcp-jvr4-r259 put the Tauri updater signing key in the frontend that
// way), a value hardcoded to make something work, or a dependency embedding
// one. A bundled desktop or mobile app is unpacked as easily as a web page, so
// "it is in the binary, not the JS" is not a mitigation - the same rule applies
// to every dist/.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDirs = ["apps/web/dist", "apps/shell/dist"];

// Extensions that carry no text worth scanning. Everything else is read.
const BINARY = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".wasm",
]);

// Shapes that are a leak wherever they appear, regardless of the environment.
const SHAPES = [
  [/-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/, "a PEM private key block"],
  [
    /eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/,
    "a JWT (three base64url segments; libSQL auth tokens are JWTs)",
  ],
  [
    /libsql:\/\/[^\s"'`]+/,
    "a libsql:// database URL (the DB belongs behind the API, never in a client)",
  ],
  [/TAURI_SIGNING_[A-Z_]*/, "a reference to the updater signing key environment"],
  [/AKIA[0-9A-Z]{16}/, "an AWS access key id"],
  [/gh[pousr]_[A-Za-z0-9]{36,}/, "a GitHub token"],
];

// Every non-public environment variable's *value* is searched for literally.
// Public means Vite may inline it: VITE_* by definition, TAURI_ENV_* because
// Tauri sets only build metadata (platform, arch, debug) under that prefix.
// Short values are skipped - they collide with ordinary code too easily to
// mean anything.
const envSecrets = Object.entries(process.env).filter(
  ([name, value]) =>
    !name.startsWith("VITE_") &&
    !name.startsWith("TAURI_ENV_") &&
    typeof value === "string" &&
    value.length >= 12,
);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (!BINARY.has(extname(entry).toLowerCase())) yield path;
  }
}

const errors = [];
let scanned = 0;

for (const distDir of distDirs) {
  const dir = join(repoRoot, distDir);
  let files;
  try {
    files = [...walk(dir)];
  } catch {
    continue; // Not built; the build that produces it will run this again.
  }
  for (const file of files) {
    scanned += 1;
    const content = readFileSync(file, "utf8");
    const where = relative(repoRoot, file);
    for (const [pattern, what] of SHAPES) {
      if (pattern.test(content)) errors.push(`${where} contains ${what} (${pattern}).`);
    }
    for (const [name, value] of envSecrets) {
      if (content.includes(value)) {
        errors.push(
          `${where} contains the value of ${name}. Only VITE_*-prefixed variables are\n` +
            "    public; everything else stays server-side. If this variable is genuinely\n" +
            "    public, rename it with the VITE_ prefix so the boundary stays legible.",
        );
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`\n  bundle-secrets: ${errors.length} leak(s) in the client build output\n`);
  for (const error of errors) console.error(`  - ${error}\n`);
  console.error("  The output ships to every user; treat anything in it as published.\n");
  process.exit(1);
}

console.log(
  `✔ bundle-secrets: no secret shapes or private env values in ${scanned} output file(s)`,
);
