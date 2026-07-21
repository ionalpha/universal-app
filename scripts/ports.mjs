import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Ports are DERIVED, never fixed. Each checkout of this template lives in a
// different directory, so hashing the repo root gives every clone its own
// stable, non-overlapping port block: you can run any number of templated
// apps side by side without collisions, and the same clone always reuses the
// same ports (predictable URLs, no "port already in use" churn between runs).
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const BLOCK_SIZE = 10;
const RANGE_START = 10000;
// 2200 blocks => 10000..31990. The top of the range sits below 32768 on
// purpose. That is the lowest port any supported OS hands out to outbound
// connections (Linux's default ip_local_port_range floor; Windows and macOS
// start at 49152). Every dev server here sets strictPort, so a port at or above
// that floor is racing every other socket on the machine and loses by exiting 1.
// Worse on Windows, which reserves whole blocks up there for Hyper-V and WSL: a
// clone that hashes into one of those can never bind and fails with EACCES on
// every run. Staying below the floor removes both failures.
const BLOCK_COUNT = 2200;
// How many blocks to walk before giving up. Deliberately bounded: an unbounded
// search would spin through 2200 blocks and 8800 socket binds on a machine
// where something systemic is wrong, instead of saying so.
const MAX_SHIFTS = 20;

// Lowercased so Windows' case-insensitive paths hash consistently.
const digest = createHash("sha1").update(repoRoot.toLowerCase()).digest();
const derivedIndex = digest.readUInt16BE(0) % BLOCK_COUNT;

export const derivedBase = RANGE_START + derivedIndex * BLOCK_SIZE;

// The resolved block is recorded here so that every entry point agrees on which
// ports this clone is ACTUALLY using, not merely which ones it would derive.
// Without this, `pnpm stop` would build its kill list from the derived block
// while the servers ran on a shifted one, report "nothing running", and leave
// them up. Gitignored; scoped to this clone.
const STATE_PATH = join(repoRoot, ".dev-ports.json");

/** The four ports and three URLs for a given block base. Pure. */
export function planFor(base) {
  const ports = {
    api: base + 1,
    web: base + 2,
    shell: base + 3,
    shellHmr: base + 4,
  };
  return {
    base,
    ports,
    urls: {
      api: `http://localhost:${ports.api}`,
      web: `http://localhost:${ports.web}`,
      shell: `http://localhost:${ports.shell}`,
    },
  };
}

// True if we can actually bind the port right now. A bind test, not a connect
// test: the failure this guards against is a port nothing is listening on that
// the OS still refuses (Windows' reserved Hyper-V/WSL ranges answer EACCES with
// no process behind them), which a connect test reports as free.
//
// Bound on 0.0.0.0 because the API binds the wildcard address; a port held only
// on ::1 by another process can still slip through, which is why a shifted
// block is a best effort and strictPort remains the backstop.
function bindable(port) {
  return new Promise((done) => {
    const probe = createServer();
    probe.once("error", () => done(false));
    probe.once("listening", () => probe.close(() => done(true)));
    probe.listen(port, "0.0.0.0");
  });
}

async function blockState(base) {
  const { ports } = planFor(base);
  const free = await Promise.all(Object.values(ports).map(bindable));
  return { allFree: free.every(Boolean), anyHeld: free.some((ok) => !ok) };
}

function readState() {
  if (!existsSync(STATE_PATH)) return null;
  try {
    const base = JSON.parse(readFileSync(STATE_PATH, "utf8")).base;
    return Number.isInteger(base) ? base : null;
  } catch {
    // A corrupt state file is not worth failing a dev run over; re-resolve.
    return null;
  }
}

/** Record the block this run settled on, for stop.mjs and the next `pnpm ports`. */
export function writeState(base) {
  try {
    writeFileSync(STATE_PATH, `${JSON.stringify({ base }, null, 2)}\n`);
  } catch {
    // Best effort. Losing the state file degrades `pnpm stop` back to the
    // derived block; it must not take the dev server down with it.
  }
}

// DEV_PORT_BASE places this clone explicitly, for a host that would rather
// assign a block it has already confirmed is free than accept the hash's
// answer. It is the bottom of the block; the four ports above it follow. It is
// also how shell.mjs hands its resolved block to the dev.mjs it spawns, so the
// two cannot probe their way to different answers.
function requestedBase() {
  const n = Number.parseInt(process.env.DEV_PORT_BASE ?? "", 10);
  return Number.isInteger(n) && n >= 1024 && n <= 65530 ? n : null;
}

/**
 * The block this clone should use, probed rather than assumed.
 *
 * Order: an explicit DEV_PORT_BASE wins outright, then a still-running block
 * recorded in the state file, then the derived block, then the next free block
 * after it. Probing never changes the answer when nothing is wrong, so a clone
 * with free ports keeps the same predictable URLs it has always had.
 */
export async function resolvePlan() {
  const requested = requestedBase();
  if (requested !== null) {
    // An explicit operator choice is not second-guessed, only reported on.
    const { anyHeld } = await blockState(requested);
    if (anyHeld) {
      warn(
        `DEV_PORT_BASE=${requested} was requested but some of ${requested + 1}-${requested + 4} cannot be bound.`,
        "Using it anyway, as asked. Unset DEV_PORT_BASE to let this clone pick a free block itself.",
      );
    }
    return { ...planFor(requested), source: "env", shifted: false };
  }

  // A recorded block whose ports are still held is this clone already running.
  // Report it as-is rather than probing it as "busy" and shifting away from the
  // very servers we started: `pnpm ports` is how the host discovers a live run.
  const recorded = readState();
  if (recorded !== null && (await blockState(recorded)).anyHeld) {
    return { ...planFor(recorded), source: "running", shifted: recorded !== derivedBase };
  }

  for (let i = 0; i < MAX_SHIFTS; i++) {
    const base = RANGE_START + ((derivedIndex + i) % BLOCK_COUNT) * BLOCK_SIZE;
    if ((await blockState(base)).allFree) {
      if (i > 0) {
        warn(
          `Ports ${derivedBase + 1}-${derivedBase + 4} are not bindable, so this run shifted to ${base + 1}-${base + 4}.`,
          "Set DEV_PORT_BASE to pin a block permanently.",
        );
      }
      return { ...planFor(base), source: i === 0 ? "derived" : "shifted", shifted: i > 0 };
    }
  }

  const last = RANGE_START + ((derivedIndex + MAX_SHIFTS - 1) % BLOCK_COUNT) * BLOCK_SIZE;
  throw new Error(
    `No free port block found: tried ${MAX_SHIFTS} blocks from ${derivedBase} to ${last} and every one had a port that could not be bound. ` +
      "That many blocked blocks in a row usually means something systemic (a firewall policy, or a very wide reserved range) rather than a busy port. " +
      "Set DEV_PORT_BASE to a block you know is free to bypass the search.",
  );
}

// stderr, so the stdout JSON below stays machine-parseable for the host.
function warn(...lines) {
  for (const line of lines) console.error(`  ${line}`);
  console.error("");
}

/**
 * Env every dev process inherits: Vite reads the *_PORT vars, the API reads
 * PORT, and the frontends read VITE_API_URL to find the API. Takes the resolved
 * plan explicitly so nothing can accidentally launch on the derived block while
 * the rest of the run uses a shifted one.
 */
export function devEnv(plan, extra = {}) {
  return {
    ...process.env,
    PORT: String(plan.ports.api),
    WEB_PORT: String(plan.ports.web),
    SHELL_PORT: String(plan.ports.shell),
    SHELL_HMR_PORT: String(plan.ports.shellHmr),
    VITE_API_URL: plan.urls.api,
    ...extra,
  };
}

// `node scripts/ports.mjs` prints the resolved plan. The host reads this to
// learn the ports before starting anything, so the shape of the JSON (and its
// exclusive ownership of stdout) is a contract.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const plan = await resolvePlan();
  console.log(
    JSON.stringify(
      {
        repoRoot,
        ports: plan.ports,
        urls: plan.urls,
        base: plan.base,
        derivedBase,
        shifted: plan.shifted,
        source: plan.source,
      },
      null,
      2,
    ),
  );
}
