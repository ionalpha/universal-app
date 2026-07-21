import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { derivedBase, planFor, repoRoot } from "./ports.mjs";

// These cover the port ALLOCATION, which has no other test surface and whose
// failure mode is a dev server that will not start (or, worse, a `pnpm stop`
// that silently stops nothing). Each case shells out to the real CLI, so the
// stdout JSON contract the host parses is exercised too, not just the module.

const STATE_PATH = join(repoRoot, ".dev-ports.json");

function resolve(env = {}) {
  const out = execFileSync(process.execPath, [join(repoRoot, "scripts", "ports.mjs")], {
    encoding: "utf8",
    env: { ...process.env, DEV_PORT_BASE: "", ...env },
  });
  return JSON.parse(out);
}

// Hold a real socket, since the whole point is that the check is a bind test.
function hold(port) {
  return new Promise((ok, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(port, "0.0.0.0", () => ok(server));
  });
}

const savedState = existsSync(STATE_PATH);
before(() => {
  if (savedState) rmSync(STATE_PATH);
});
after(() => {
  if (existsSync(STATE_PATH)) rmSync(STATE_PATH);
});

test("derives the same block every run when the ports are free", () => {
  const first = resolve();
  const second = resolve();
  assert.equal(first.base, derivedBase);
  assert.equal(second.base, derivedBase);
  assert.equal(first.shifted, false);
  assert.equal(first.source, "derived");
});

test("stays below the lowest ephemeral floor of any supported OS", () => {
  // 32768 is Linux's default ip_local_port_range floor. Windows and macOS start
  // at 49152, so clearing the Linux one clears all three.
  const highest = 10000 + 2199 * 10 + 4;
  assert.ok(highest < 32768, `highest possible port ${highest} must stay under 32768`);
  assert.ok(derivedBase >= 10000 && derivedBase + 4 <= highest);
});

test("plan is internally coherent", () => {
  const { base, ports, urls } = planFor(20000);
  assert.equal(base, 20000);
  assert.deepEqual(ports, { api: 20001, web: 20002, shell: 20003, shellHmr: 20004 });
  assert.equal(urls.api, "http://localhost:20001");
});

test("an explicit DEV_PORT_BASE wins over the derived block", () => {
  const plan = resolve({ DEV_PORT_BASE: "20500" });
  assert.equal(plan.base, 20500);
  assert.equal(plan.source, "env");
  assert.equal(plan.ports.api, 20501);
});

test("an out-of-range DEV_PORT_BASE is ignored, not obeyed into an unbindable run", () => {
  assert.equal(resolve({ DEV_PORT_BASE: "99999" }).base, derivedBase);
  assert.equal(resolve({ DEV_PORT_BASE: "80" }).base, derivedBase);
  assert.equal(resolve({ DEV_PORT_BASE: "not-a-number" }).base, derivedBase);
});

test("shifts to the next block when the derived one is not bindable", async () => {
  const blocker = await hold(derivedBase + 2);
  try {
    const plan = resolve();
    assert.equal(plan.shifted, true);
    assert.equal(plan.source, "shifted");
    assert.equal(plan.base, derivedBase + 10);
    // The whole plan moves together; a half-shifted plan would point the Tauri
    // window at one block and the API at another.
    assert.equal(plan.ports.api, derivedBase + 11);
    assert.equal(plan.urls.shell, `http://localhost:${derivedBase + 13}`);
  } finally {
    blocker.close();
  }
});

test("returns to the derived block once it frees up", async () => {
  const blocker = await hold(derivedBase + 2);
  assert.equal(resolve().base, derivedBase + 10);
  blocker.close();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(resolve().base, derivedBase, "predictable URLs must come back");
});

test("a recorded block that is still held is reported, not probed away from", async () => {
  // This is what makes `pnpm ports` truthful while servers are running: probing
  // a live block would find it busy and shift AWAY from the very run the host
  // is asking about.
  const runningBase = derivedBase + 100;
  writeFileSync(STATE_PATH, JSON.stringify({ base: runningBase }));
  const blocker = await hold(runningBase + 3);
  try {
    const plan = resolve();
    assert.equal(plan.base, runningBase);
    assert.equal(plan.source, "running");
  } finally {
    blocker.close();
    rmSync(STATE_PATH);
  }
});

test("a stale or corrupt state file is ignored rather than fatal", () => {
  // Self-healing: nothing has to remember to clean this up.
  writeFileSync(STATE_PATH, JSON.stringify({ base: derivedBase + 100 }));
  assert.equal(resolve().base, derivedBase, "stale block whose ports are free is ignored");

  writeFileSync(STATE_PATH, "{ not json");
  assert.equal(resolve().base, derivedBase, "corrupt state must not fail the run");
  rmSync(STATE_PATH);
});

test("warnings go to stderr so the stdout JSON stays parseable", async () => {
  const blocker = await hold(derivedBase + 2);
  try {
    // resolve() would throw on any stdout contamination; the shift path warns.
    const plan = resolve();
    assert.equal(plan.shifted, true);
  } finally {
    blocker.close();
  }
});
