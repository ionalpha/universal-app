import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  escapeRegExp,
  expectedFor,
  identifierProblems,
  readIdentity,
  readSite,
  repoRoot as realRoot,
  SITES,
  siteHolds,
  slugify,
} from "./identity.mjs";

// Template integrity: a fresh clone must be one app, not two half-renamed ones.
//
// Everything here fails a build somewhere, usually far from the cause:
//   - a lib crate whose name no longer matches the `::run()` call in main.rs
//     does not compile at all, and nothing says so until the first cargo build;
//   - a Cargo.lock that does not mention the renamed crate breaks the first
//     `cargo build --locked`, which is what CI runs;
//   - a bundle identifier with a Java keyword in it builds on desktop and dies
//     in the Android toolchain;
//   - a generated native project left over from the old name installs a second,
//     differently-identified app onto the device.
//
// The rename script writes every identity site from one display name; this
// reads them all back. Run on every `pnpm check`, so template rot is loud.

// TEMPLATE_ROOT points both this check and rename.mjs at a fixture tree; the
// regression tests rename a copy and re-check it. Every real run uses the repo.
const root = process.env.TEMPLATE_ROOT ?? realRoot;

const errors = [];
const fail = (message) => errors.push(message);
const read = (relPath) => readFileSync(join(root, relPath), "utf8");

function report() {
  console.error(`\n  template: ${errors.length} integrity failure(s)\n`);
  for (const error of errors) console.error(`  - ${error}\n`);
  console.error('  Rename with `pnpm rename "My App"`, which writes every site at once.\n');
  process.exit(1);
}

// --- 0. Everything the rest of this reads exists --------------------------

// Checked first and on its own: a file that is missing here would otherwise
// surface as a stack trace from deep inside a rule, and the lockfiles are a
// rule in their own right (without them an install is not reproducible).
const REQUIRED = [
  ...new Set(SITES.map((site) => site.file)),
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "apps/shell/src-tauri/Cargo.lock",
  "apps/shell/src-tauri/src/main.rs",
];
for (const file of REQUIRED) {
  if (!existsSync(join(root, file))) fail(`${file} is missing.`);
}
if (errors.length > 0) report();

// --- 1. One identity, spelled the same way everywhere --------------------

const { name, slug, identifier } = readIdentity(root);

if (!name || !name.trim()) fail("tauri.conf.json has no productName; that is the source of truth.");
if (slug !== slugify(name)) {
  fail(
    `the workspace name is "${slug}" but the product name "${name}" slugifies to ` +
      `"${slugify(name)}". One of the two was renamed by hand; run \`pnpm rename\` instead.`,
  );
}

for (const site of SITES) {
  const value = readSite(site, root);
  if (value === null) {
    fail(
      `${site.file} no longer contains ${site.what} where scripts/identity.mjs looks for it. ` +
        "Either restore it or update the SITES table - an identity site that cannot be read " +
        "is an identity site that cannot be renamed.",
    );
    continue;
  }
  if (!siteHolds(site, value, name)) {
    fail(
      `${site.file} carries ${site.what} as "${value}", but the product name is "${name}" ` +
        `(expected "${expectedFor(site, name)}").`,
    );
  }
}

for (const problem of identifierProblems(identifier)) {
  fail(`the bundle identifier "${identifier}" ${problem}.`);
}

// --- 2. The Rust side actually builds ------------------------------------

const crateDir = "apps/shell/src-tauri";
const cargoToml = read(`${crateDir}/Cargo.toml`);
const libName = /\[lib\][\s\S]*?^name = "([^"]+)"/m.exec(cargoToml)?.[1];
const mainRs = read(`${crateDir}/src/main.rs`);
const entryCrate = /^\s*([A-Za-z_][A-Za-z0-9_]*)::run\(\)/m.exec(mainRs)?.[1];

if (!libName) {
  fail(`${crateDir}/Cargo.toml has no [lib] name; mobile links against the lib by name.`);
} else if (!entryCrate) {
  fail(`${crateDir}/src/main.rs does not call <lib>::run(); the app has no entry point.`);
} else if (entryCrate !== libName) {
  fail(
    `${crateDir}/src/main.rs calls ${entryCrate}::run() but the lib crate is named ` +
      `"${libName}". This does not compile. (The lib name is deliberately identity-free - ` +
      "it is not renamed with the app, precisely so this cannot happen.)",
  );
}

const defaultRun = /^default-run = "([^"]+)"/m.exec(cargoToml)?.[1];
if (defaultRun) {
  const hasBin = defaultRun === slug ? existsSync(join(root, crateDir, "src/main.rs")) : false;
  const named = existsSync(join(root, crateDir, "src/bin", `${defaultRun}.rs`));
  if (!hasBin && !named) {
    fail(
      `Cargo.toml sets default-run = "${defaultRun}", but no such binary exists. ` +
        "`tauri dev` shells out to a bare `cargo run` and will refuse to pick one.",
    );
  }
}

// A rename that does not reach Cargo.lock passes every local build (cargo just
// updates it) and fails the first `--locked` one, which is what CI runs.
const cargoLock = read(`${crateDir}/Cargo.lock`);
if (!new RegExp(`\\[\\[package\\]\\]\\nname = "${escapeRegExp(slug)}"\\n`).test(cargoLock)) {
  fail(
    `Cargo.lock has no [[package]] entry for "${slug}". A \`cargo build --locked\` ` +
      "(what CI runs) fails on this even though a local build silently repairs it.",
  );
}

// --- 3. The workspace graph resolves, with nothing dangling --------------

const workspaceGlobs = [...read("pnpm-workspace.yaml").matchAll(/^\s*-\s*"([^"]+)"/gm)].map(
  (match) => match[1],
);
const packages = new Map();
for (const glob of workspaceGlobs) {
  const dir = glob.replace(/\/\*$/, "");
  if (!glob.endsWith("/*") || !existsSync(join(root, dir))) continue;
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = join(dir, entry.name, "package.json");
    if (!existsSync(join(root, manifest))) {
      fail(`${dir}/${entry.name} matches a workspace glob but has no package.json.`);
      continue;
    }
    const pkg = JSON.parse(read(manifest));
    packages.set(pkg.name, { dir: `${dir}/${entry.name}`, pkg });
  }
}

const dependedOn = new Set();
for (const [, { dir, pkg }] of packages) {
  for (const field of ["dependencies", "devDependencies"]) {
    for (const [dep, range] of Object.entries(pkg[field] ?? {})) {
      if (!range.startsWith("workspace:")) continue;
      dependedOn.add(dep);
      if (!packages.has(dep)) {
        fail(`${dir}/package.json depends on ${dep} (workspace:), which no package provides.`);
      }
    }
  }
}

// Packages a clone is expected to wire up itself, one reviewed reason each.
// The list is deliberately explicit: an unconsumed package is normally dead
// wiring, so the exception has to be stated rather than assumed.
// - @repo/db: the persistence offering. It ships an example schema and
//   repository marked reference-only (see knip.json, which ignores the same
//   file) because the template cannot know what a clone stores. Wiring it into
//   the API would ship a table nobody asked for.
const INTENTIONALLY_UNCONSUMED = new Set(["@repo/db"]);

// Dead wiring, the packaged kind: a package nothing depends on still ships in
// the template, is still maintained by `pnpm check`, and reaches no user.
for (const [pkgName, { dir }] of packages) {
  if (!dir.startsWith("packages/")) continue;
  if (dependedOn.has(pkgName)) {
    if (INTENTIONALLY_UNCONSUMED.has(pkgName)) {
      fail(
        `${dir} is listed as intentionally unconsumed but something now depends on it. ` +
          "Remove it from INTENTIONALLY_UNCONSUMED in scripts/check-template.mjs.",
      );
    }
    continue;
  }
  if (!INTENTIONALLY_UNCONSUMED.has(pkgName)) {
    fail(
      `${dir} is in the workspace but nothing depends on it. Either wire it into an app, ` +
        "delete it, or add it to INTENTIONALLY_UNCONSUMED in scripts/check-template.mjs " +
        "with a reason; a package that reaches no target is dead weight a clone inherits.",
    );
  }
}

// --- 4. Generated native projects match the current identity -------------

// gen/ is git-ignored and regenerated by the Tauri CLI, so a clone that renames
// after an `android init` keeps a project built around the old identifier: it
// installs alongside the real app rather than replacing it.
const genAndroid = join(root, crateDir, "gen/android/app/build.gradle.kts");
if (existsSync(genAndroid)) {
  const gradle = readFileSync(genAndroid, "utf8");
  for (const key of ["namespace", "applicationId"]) {
    const value = new RegExp(`${key}\\s*=\\s*"([^"]+)"`).exec(gradle)?.[1];
    if (value && value !== identifier) {
      fail(
        `the generated Android project's ${key} is "${value}" but the bundle identifier is ` +
          `"${identifier}". Delete ${crateDir}/gen/android and re-run \`pnpm mobile:android\`.`,
      );
    }
  }
}

const genApple = join(root, crateDir, "gen/apple");
if (existsSync(genApple) && !existsSync(join(genApple, `${slug}_iOS`))) {
  fail(
    `${crateDir}/gen/apple exists but holds no ${slug}_iOS project, so it was generated for ` +
      "a different crate name. Delete it and re-run `pnpm mobile:ios`.",
  );
}

// --- Verdict -------------------------------------------------------------

if (errors.length > 0) report();

console.log(
  `✔ template: "${name}" (${slug}, ${identifier}) consistent across ${SITES.length} identity ` +
    `sites, ${packages.size} workspace packages resolve, Rust entry point matches`,
);
