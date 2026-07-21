import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Ports are DERIVED, never fixed. Each checkout of this template lives in a
// different directory, so hashing the repo root gives every clone its own
// stable, non-overlapping port block: you can run any number of templated
// apps side by side without collisions, and the same clone always reuses the
// same ports (predictable URLs, no "port already in use" churn between runs).
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Lowercased so Windows' case-insensitive paths hash consistently.
const digest = createHash("sha1").update(repoRoot.toLowerCase()).digest();

// 10000..31990 in blocks of 10, one block per clone.
//
// The top of the range sits below 32768 on purpose. That is the lowest port any
// supported OS hands out to outbound connections (Linux's default
// ip_local_port_range floor; Windows and macOS start at 49152). Every dev server
// here sets strictPort, so a port at or above that floor is racing every other
// socket on the machine and loses by exiting 1. Worse on Windows, which reserves
// whole blocks up there for Hyper-V and WSL: a clone that hashes into one of
// those can never bind, fails with EACCES on every run, and the only escape is
// moving the folder. Staying below the floor removes both failures.
const derived = 10000 + (digest.readUInt16BE(0) % 2200) * 10;

// DEV_PORT_BASE places this clone explicitly, for a host that would rather assign
// a block it has already confirmed is free than accept the hash's answer. It is
// the bottom of the block; the four ports below follow it. Anything outside the
// usable range is ignored rather than obeyed into an unbindable run.
const requested = Number.parseInt(process.env.DEV_PORT_BASE ?? "", 10);
const base =
  Number.isInteger(requested) && requested >= 1024 && requested <= 65530
    ? requested
    : derived;

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
