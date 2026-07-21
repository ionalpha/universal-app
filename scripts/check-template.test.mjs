import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

// Drift tests: each case takes a faithful copy of the real identity surface,
// breaks it the way a hand-rename breaks it (the title updated but the package
// name not, main.rs calling a crate that no longer exists, a stale Cargo.lock),
// and asserts `pnpm template` fails and names it. The last pair go the other
// way: `pnpm rename` on the same copy has to leave it passing.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = join(repoRoot, "scripts", "check-template.mjs");
const rename = join(repoRoot, "scripts", "rename.mjs");
const stage = mkdtempSync(join(tmpdir(), "check-template-"));
after(() => rmSync(stage, { recursive: true, force: true }));

// Everything the check reads, copied whole. The workspace graph is real (every
// package.json), so an orphan or a dangling workspace: dep is a genuine
// tamper rather than a fixture artefact.
const FILES = [
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "README.md",
  "apps/shell/index.html",
  "apps/web/index.html",
  "apps/web/vite.config.ts",
  "apps/shell/src-tauri/Cargo.toml",
  "apps/shell/src-tauri/Cargo.lock",
  "apps/shell/src-tauri/tauri.conf.json",
  "apps/shell/src-tauri/src/main.rs",
  "packages/client/src/app/app-name.ts",
];

function copyTemplate(dest) {
  for (const file of FILES) {
    mkdirSync(join(dest, dirname(file)), { recursive: true });
    cpSync(join(repoRoot, file), join(dest, file));
  }
  for (const dir of ["apps", "packages"]) {
    for (const entry of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      mkdirSync(join(dest, dir, entry.name), { recursive: true });
      cpSync(
        join(repoRoot, dir, entry.name, "package.json"),
        join(dest, dir, entry.name, "package.json"),
      );
    }
  }
}

let n = 0;
function run(script, args, tamper) {
  const root = join(stage, `root-${n++}`);
  copyTemplate(root);
  if (tamper) tamper(root);
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      env: { ...process.env, TEMPLATE_ROOT: root },
    });
    return { code: 0, output: stdout, root };
  } catch (error) {
    return { code: error.status, output: `${error.stdout}${error.stderr}`, root };
  }
}

const template = (tamper) => run(check, [], tamper);

function edit(root, relPath, replace) {
  const path = join(root, relPath);
  const before = readFileSync(path, "utf8");
  const after = replace(before);
  assert.notEqual(after, before, `tamper did not change ${relPath}`);
  writeFileSync(path, after);
}

test("the real, untampered template passes", () => {
  const { code, output } = template(null);
  assert.equal(code, 0, output);
  assert.match(output, /identity sites/);
});

test("a product name renamed without the workspace name fails", () => {
  const { code, output } = template((root) =>
    edit(root, "apps/shell/src-tauri/tauri.conf.json", (c) =>
      c.replace(/"productName": "[^"]+"/, '"productName": "Acme Notes"'),
    ),
  );
  assert.equal(code, 1);
  assert.match(output, /slugifies to "acme-notes"/);
});

test("a leftover template title in a target's index.html fails", () => {
  const { code, output } = template((root) => {
    edit(root, "apps/shell/src-tauri/tauri.conf.json", (c) =>
      c.replace(/"productName": "[^"]+"/, '"productName": "Acme Notes"'),
    );
    edit(root, "package.json", (c) => c.replace(/"name": "[^"]+"/, '"name": "acme-notes"'));
    // Every other site renamed; the web target's title left behind.
    for (const [file, pattern, next] of [
      ["apps/shell/src-tauri/tauri.conf.json", /"title": "[^"]+"/, '"title": "Acme Notes"'],
      ["apps/shell/index.html", /<title>[^<]+<\/title>/, "<title>Acme Notes</title>"],
      ["apps/web/vite.config.ts", /name: "Universal App"/, 'name: "Acme Notes"'],
      ["apps/web/vite.config.ts", /short_name: "[^"]+"/, 'short_name: "Acme"'],
      ["packages/client/src/app/app-name.ts", /"Universal App"/, '"Acme Notes"'],
      ["README.md", /^# .+$/m, "# Acme Notes"],
      ["apps/shell/src-tauri/Cargo.toml", /^description = "[^"]+"/m, 'description = "Acme Notes"'],
      ["apps/shell/src-tauri/Cargo.toml", /^name = "universal-app"/m, 'name = "acme-notes"'],
      ["apps/shell/src-tauri/Cargo.toml", /^default-run = "[^"]+"/m, 'default-run = "acme-notes"'],
      ["apps/shell/src-tauri/Cargo.lock", /name = "universal-app"/, 'name = "acme-notes"'],
    ]) {
      edit(root, file, (c) => c.replace(pattern, next));
    }
  });
  assert.equal(code, 1);
  assert.match(output, /apps\/web\/index\.html carries the document title as "Universal App"/);
});

test("main.rs calling a crate that is not the lib fails - this does not compile", () => {
  const { code, output } = template((root) =>
    edit(root, "apps/shell/src-tauri/src/main.rs", (c) =>
      c.replace("app_lib::run()", "acme_notes_lib::run()"),
    ),
  );
  assert.equal(code, 1);
  assert.match(output, /calls acme_notes_lib::run\(\) but the lib crate is named "app_lib"/);
});

test("a Cargo.lock that never learned the new crate name fails", () => {
  const { code, output } = template((root) =>
    edit(root, "apps/shell/src-tauri/Cargo.lock", (c) =>
      c.replace('name = "universal-app"', 'name = "universal-app-old"'),
    ),
  );
  assert.equal(code, 1);
  assert.match(output, /Cargo\.lock has no \[\[package\]\] entry/);
});

test("default-run naming a binary that does not exist fails", () => {
  const { code, output } = template((root) =>
    edit(root, "apps/shell/src-tauri/Cargo.toml", (c) =>
      c.replace(/^default-run = "[^"]+"/m, 'default-run = "export_bindings"'),
    ),
  );
  assert.equal(code, 1);
  assert.match(output, /no such binary exists/);
});

test("a bundle identifier segment that is a Java keyword fails - Android rejects it", () => {
  const { code, output } = template((root) =>
    edit(root, "apps/shell/src-tauri/tauri.conf.json", (c) =>
      c.replace(/"identifier": "[^"]+"/, '"identifier": "com.acme.object"'),
    ),
  );
  assert.equal(code, 1);
  assert.match(output, /Java\/Kotlin keyword/);
});

test("a single-segment bundle identifier fails", () => {
  const { code, output } = template((root) =>
    edit(root, "apps/shell/src-tauri/tauri.conf.json", (c) =>
      c.replace(/"identifier": "[^"]+"/, '"identifier": "acmenotes"'),
    ),
  );
  assert.equal(code, 1);
  assert.match(output, /at least two segments/);
});

test("a workspace: dependency on a package nothing provides fails", () => {
  const { code, output } = template((root) =>
    edit(root, "apps/web/package.json", (c) =>
      c.replace('"@repo/client": "workspace:*"', '"@repo/ui": "workspace:*"'),
    ),
  );
  assert.equal(code, 1);
  assert.match(output, /depends on @repo\/ui \(workspace:\), which no package provides/);
});

test("a package nothing depends on fails as dead wiring", () => {
  const { code, output } = template((root) => {
    mkdirSync(join(root, "packages/orphan"), { recursive: true });
    writeFileSync(
      join(root, "packages/orphan/package.json"),
      JSON.stringify({ name: "@repo/orphan", version: "0.0.0", private: true }),
    );
  });
  assert.equal(code, 1);
  assert.match(output, /packages\/orphan is in the workspace but nothing depends on it/);
});

test("a generated Android project left on the old identifier fails", () => {
  const { code, output } = template((root) => {
    const app = join(root, "apps/shell/src-tauri/gen/android/app");
    mkdirSync(app, { recursive: true });
    writeFileSync(
      join(app, "build.gradle.kts"),
      'android {\n  namespace = "com.oldname.app"\n  defaultConfig {\n    applicationId = "com.oldname.app"\n  }\n}\n',
    );
  });
  assert.equal(code, 1);
  assert.match(output, /generated Android project's namespace is "com\.oldname\.app"/);
});

test("rename writes every site at once, and the result passes the check", () => {
  const { code, output, root } = run(rename, ["Acme Notes", "--force"], null);
  assert.equal(code, 0, output);
  assert.match(output, /identity sites/); // rename runs the check itself

  const read = (relPath) => readFileSync(join(root, relPath), "utf8");
  assert.match(read("package.json"), /"name": "acme-notes"/);
  assert.match(read("apps/shell/src-tauri/Cargo.toml"), /^name = "acme-notes"/m);
  assert.match(read("apps/shell/src-tauri/Cargo.toml"), /^default-run = "acme-notes"/m);
  assert.match(read("apps/shell/src-tauri/Cargo.lock"), /name = "acme-notes"/);
  assert.match(read("apps/shell/src-tauri/tauri.conf.json"), /"productName": "Acme Notes"/);
  assert.match(
    read("apps/shell/src-tauri/tauri.conf.json"),
    /"identifier": "com.example.acmenotes"/,
  );
  assert.match(read("apps/web/index.html"), /<title>Acme Notes<\/title>/);
  assert.match(read("apps/web/vite.config.ts"), /short_name: "Acme"/);
  assert.match(read("packages/client/src/app/app-name.ts"), /APP_NAME = "Acme Notes"/);
  assert.match(read("README.md"), /^# Acme Notes/m);
  // The lib crate is deliberately not renamed: main.rs calls it by name, and
  // that pair is the single most common way a starter fails to compile.
  assert.match(read("apps/shell/src-tauri/src/main.rs"), /app_lib::run\(\)/);
});

test("rename refuses a name whose slug cannot be a package name", () => {
  const { code, output } = run(rename, ["42", "--force"], null);
  assert.equal(code, 1);
  assert.match(output, /not a usable npm\/Cargo package name/);
});

test("rename refuses an identifier Android cannot use", () => {
  const { code, output } = run(rename, ["Acme Notes", "--identifier", "com.acme.app", "--force"]);
  assert.equal(code, 1);
  assert.match(output, /must not end in "\.app"/);
});

test("rename takes an explicit identifier and an author", () => {
  const { code, output, root } = run(
    rename,
    ["Acme Notes", "--identifier", "com.acme.notes", "--author", "Acme Inc", "--force"],
    null,
  );
  assert.equal(code, 0, output);
  const conf = readFileSync(join(root, "apps/shell/src-tauri/tauri.conf.json"), "utf8");
  assert.match(conf, /"identifier": "com.acme.notes"/);
  const cargo = readFileSync(join(root, "apps/shell/src-tauri/Cargo.toml"), "utf8");
  assert.match(cargo, /^authors = \["Acme Inc"\]/m);
});
