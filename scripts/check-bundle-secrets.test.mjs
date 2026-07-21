import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

// These are regression tests for the control, not the happy path: each case
// plants exactly one thing in a fixture "dist" and asserts the scan's verdict
// flips. GHSA-2rcp-jvr4-r259 (the Tauri updater signing key inlined into the
// frontend via a widened envPrefix) is the incident the planted-key cases
// re-enact - if these fail, that leak ships silently again.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "scripts", "check-bundle-secrets.mjs");
const fixtures = mkdtempSync(join(tmpdir(), "bundle-secrets-"));
after(() => rmSync(fixtures, { recursive: true, force: true }));

let n = 0;
function scan(content, env = {}) {
  const dir = join(fixtures, `dist-${n++}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "app.js"), content);
  try {
    const stdout = execFileSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, BUNDLE_SECRETS_DIRS: dir, ...env },
    });
    return { code: 0, output: stdout };
  } catch (error) {
    return { code: error.status, output: `${error.stdout}${error.stderr}` };
  }
}

test("a planted signing-key value in the output fails the scan", () => {
  const key = "dW50cnVzdGVkIGNvbW1lbnQ6IGZha2Uta2V5LWZvci10ZXN0";
  const { code, output } = scan(`const k = "${key}";`, {
    TAURI_SIGNING_PRIVATE_KEY: key,
  });
  assert.equal(code, 1);
  assert.match(output, /TAURI_SIGNING_PRIVATE_KEY/);
});

test("even with no key set, the variable's name in output fails the shape rule", () => {
  const { code, output } = scan('process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? ""');
  assert.equal(code, 1);
  assert.match(output, /updater signing key/);
});

test("a PEM private key block fails regardless of environment", () => {
  const { code } = scan("-----BEGIN RSA PRIVATE KEY-----\nMIIE...");
  assert.equal(code, 1);
});

test("any non-VITE env value appearing in output fails, named in the report", () => {
  const { code, output } = scan('const dsn = "postgres-password-hunter2-long";', {
    DATABASE_PASSWORD: "postgres-password-hunter2-long",
  });
  assert.equal(code, 1);
  assert.match(output, /DATABASE_PASSWORD/);
});

test("a VITE_-prefixed value in output passes: that prefix means public", () => {
  const { code } = scan('const url = "https://api.example.com/v1-public";', {
    VITE_API_URL: "https://api.example.com/v1-public",
  });
  assert.equal(code, 0);
});

test("clean output passes and reports what it scanned", () => {
  const { code, output } = scan('console.log("hello");');
  assert.equal(code, 0);
  assert.match(output, /no secret shapes/);
});
