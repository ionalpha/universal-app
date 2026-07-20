import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Ports are DERIVED, never fixed. Each checkout of this template lives in a
// different directory, so hashing the repo root gives every clone its own
// stable, non-overlapping port block — you can run any number of templated
// apps side by side without collisions, and the same clone always reuses the
// same ports (predictable URLs, no "port already in use" churn between runs).
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Lowercased so Windows' case-insensitive paths hash consistently.
const digest = createHash("sha1").update(repoRoot.toLowerCase()).digest();
// 10000..59990 in blocks of 10 — one block per clone, comfortably clear of the
// ephemeral range and low-collision across realistic numbers of clones.
const base = 10000 + (digest.readUInt16BE(0) % 5000) * 10;

export const ports = {
  api: base + 1,
  web: base + 2,
  shell: base + 3,
  shellHmr: base + 4,
};

export const urls = {
  api: `http://localhost:${ports.api}`,
  web: `http://localhost:${ports.web}`,
  shell: `http://localhost:${ports.shell}`,
};

// Env every dev process inherits: Vite reads the *_PORT vars, the API reads
// PORT, and the frontends read VITE_API_URL to find the API.
export function devEnv(extra = {}) {
  return {
    ...process.env,
    PORT: String(ports.api),
    WEB_PORT: String(ports.web),
    SHELL_PORT: String(ports.shell),
    SHELL_HMR_PORT: String(ports.shellHmr),
    VITE_API_URL: urls.api,
    ...extra,
  };
}

// `node scripts/ports.mjs` prints the resolved plan (handy for debugging).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify({ repoRoot, ports, urls }, null, 2));
}
