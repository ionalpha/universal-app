import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

// Tamper tests: each case takes a faithful copy of the real security config,
// breaks exactly one control the way it breaks in practice (a null CSP, a
// pasted `core:default`, a widened envPrefix), and asserts `pnpm security`
// fails and names it. The point is that removing a control is a visible act -
// if the untampered copy ever fails, or a tampered one passes, the guard has
// drifted from the config it guards.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "scripts", "check-security.mjs");
const stage = mkdtempSync(join(tmpdir(), "check-security-"));
after(() => rmSync(stage, { recursive: true, force: true }));

// One faithful copy of everything the check reads. Each test then clones it
// cheaply and edits one file. node_modules are junctioned, not copied: the
// Vite version floor resolves the real installed vite through them.
function copyConfig(dest) {
  for (const app of ["apps/shell", "apps/web"]) {
    mkdirSync(join(dest, app), { recursive: true });
    cpSync(join(repoRoot, app, "vite.config.ts"), join(dest, app, "vite.config.ts"));
    cpSync(join(repoRoot, app, "package.json"), join(dest, app, "package.json"));
    symlinkSync(join(repoRoot, app, "node_modules"), join(dest, app, "node_modules"), "junction");
  }
  const crate = "apps/shell/src-tauri";
  mkdirSync(join(dest, crate), { recursive: true });
  for (const file of ["tauri.conf.json", "Cargo.toml"]) {
    cpSync(join(repoRoot, crate, file), join(dest, crate, file));
  }
  cpSync(join(repoRoot, crate, "capabilities"), join(dest, crate, "capabilities"), {
    recursive: true,
  });
}

let n = 0;
function check(tamper) {
  const root = join(stage, `root-${n++}`);
  copyConfig(root);
  if (tamper) tamper(root);
  try {
    const stdout = execFileSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, SECURITY_CHECK_ROOT: root },
    });
    return { code: 0, output: stdout };
  } catch (error) {
    return { code: error.status, output: `${error.stdout}${error.stderr}` };
  }
}

function editJson(root, relPath, edit) {
  const path = join(root, relPath);
  const value = JSON.parse(readFileSync(path, "utf8"));
  edit(value);
  writeFileSync(path, JSON.stringify(value, null, 2));
}

test("the real, untampered config passes", () => {
  const { code, output } = check(null);
  assert.equal(code, 0, output);
  assert.match(output, /CSP enforced/);
});

test("nulling the CSP fails - the default most Tauri starters ship", () => {
  const { code, output } = check((root) =>
    editJson(root, "apps/shell/src-tauri/tauri.conf.json", (conf) => {
      conf.app.security.csp = null;
    }),
  );
  assert.equal(code, 1);
  assert.match(output, /csp is null or empty/);
});

test("pasting core:default into a capability fails - grants ~100 commands", () => {
  const { code, output } = check((root) =>
    editJson(root, "apps/shell/src-tauri/capabilities/default.json", (cap) => {
      cap.permissions = [...(cap.permissions ?? []), "core:default"];
    }),
  );
  assert.equal(code, 1);
  assert.match(output, /not in ALLOWED_PERMISSIONS/);
});

test("a capability targeting every window fails", () => {
  const { code, output } = check((root) =>
    editJson(root, "apps/shell/src-tauri/capabilities/default.json", (cap) => {
      cap.windows = ["*"];
    }),
  );
  assert.equal(code, 1);
  assert.match(output, /targets "\*"/);
});

test('widening envPrefix to bare "TAURI_" fails - the GHSA-2rcp-jvr4-r259 config', () => {
  const { code, output } = check((root) => {
    const path = join(root, "apps/shell/vite.config.ts");
    const source = readFileSync(path, "utf8");
    const widened = source.replace(/envPrefix:\s*\[([^\]]*)\]/, 'envPrefix: [$1, "TAURI_"]');
    assert.notEqual(widened, source, "expected an envPrefix declaration to widen");
    writeFileSync(path, widened);
  });
  assert.equal(code, 1);
  assert.match(output, /envPrefix "TAURI_"/);
});

test("dropping a hardened protocol header fails", () => {
  const { code, output } = check((root) =>
    editJson(root, "apps/shell/src-tauri/tauri.conf.json", (conf) => {
      delete conf.app.security.headers["X-Content-Type-Options"];
    }),
  );
  assert.equal(code, 1);
  assert.match(output, /X-Content-Type-Options/);
});

test("enabling the devtools cargo feature fails - it ships the inspector", () => {
  const { code, output } = check((root) => {
    const path = join(root, "apps/shell/src-tauri/Cargo.toml");
    const source = readFileSync(path, "utf8");
    writeFileSync(path, source.replace(/^(tauri\s*=\s*\{)/m, '$1 features = ["devtools"],'));
  });
  assert.equal(code, 1);
  assert.match(output, /devtools/);
});
