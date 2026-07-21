import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  defaultIdentifier,
  escapeRegExp,
  expectedFor,
  identifierProblems,
  readIdentity,
  repoRoot,
  SITES,
  slugify,
  writeSite,
} from "./identity.mjs";

// Makes a clone yours, in one command:
//
//   pnpm rename "My App"
//   pnpm rename "My App" --identifier com.acme.myapp --author "Acme Inc"
//
// Every site in scripts/identity.mjs is written from the one display name, then
// `pnpm template` is run to prove it. A find-and-replace by hand reaches the
// sites you think of and leaves the rest, which is how a window title keeps the
// old name and a phone installs the old bundle identifier.

// `--force` is a switch; every other flag takes the next argument as its value.
const argv = process.argv.slice(2);
const flags = new Map();
const positional = [];
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === "--force") {
    flags.set("force", true);
  } else if (arg.startsWith("--")) {
    flags.set(arg.slice(2), argv[index + 1]);
    index += 1;
  } else {
    positional.push(arg);
  }
}
const flag = (flagName) => flags.get(flagName);
const displayName = positional[0];

// TEMPLATE_ROOT retargets the rewrite at a fixture tree so the regression tests
// can rename a copy and check it. Every real run works on the repo itself.
const root = process.env.TEMPLATE_ROOT ?? repoRoot;

function die(message) {
  console.error(`\n  rename: ${message}\n`);
  process.exit(1);
}

if (!displayName) {
  die('usage: pnpm rename "My App" [--identifier com.acme.myapp] [--author "Acme Inc"]');
}

// --- Validate before touching anything -----------------------------------

const slug = slugify(displayName);
if (/["\\<>]/.test(displayName)) {
  die(
    "the name cannot contain quotes, backslashes or angle brackets: it goes into JSON, TOML, HTML and Rust.",
  );
}
if (displayName.length > 60)
  die("the name is over 60 characters; stores truncate long ones anyway.");
if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
  die(
    `"${displayName}" slugifies to "${slug}", which is not a usable npm/Cargo package name ` +
      "(must start with a letter and contain only lowercase letters, digits and hyphens).",
  );
}
// Windows refuses these as file names, and Cargo names the output binary after
// the crate, so the build fails at link time on one platform only.
if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(slug)) {
  die(`"${slug}" is a reserved device name on Windows and cannot name a binary.`);
}

const current = readIdentity(root);
const identifier = flag("identifier") ?? defaultIdentifier(slug);
const problems = identifierProblems(identifier);
if (problems.length > 0) {
  die(`the bundle identifier "${identifier}" ${problems.join("; and ")}.`);
}

// A rename rewrites a dozen tracked files. If something else is already
// uncommitted, `git diff` afterwards cannot tell the two apart - which is the
// review you most want to be able to do.
if (!flag("force")) {
  try {
    const dirty = execFileSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    if (dirty) {
      die(
        "the working tree has uncommitted changes. Commit or stash first so the rename is a " +
          "reviewable diff of its own, or pass --force.",
      );
    }
  } catch {
    // No git, or not a repository: nothing to protect.
  }
}

// --- Write ---------------------------------------------------------------

const changed = new Map();
const edit = (relPath, mutate) => {
  const path = join(root, relPath);
  const before = changed.get(relPath) ?? readFileSync(path, "utf8");
  changed.set(relPath, mutate(before));
};

for (const site of SITES) {
  edit(site.file, (content) => writeSite(content, site, expectedFor(site, displayName)));
}

// Cargo.lock names the crate too. Left stale it passes every local build (cargo
// quietly repairs it) and fails the first `cargo build --locked`, which is what
// CI runs and what a release build should use.
edit("apps/shell/src-tauri/Cargo.lock", (content) =>
  content.replace(
    new RegExp(`(\\[\\[package\\]\\]\\nname = )"${current.slug}"`, "g"),
    `$1"${slug}"`,
  ),
);

edit("apps/shell/src-tauri/tauri.conf.json", (content) =>
  content.replace(/("identifier": )"[^"]+"/, `$1"${identifier}"`),
);

const author = flag("author");
if (author) {
  edit("apps/shell/src-tauri/Cargo.toml", (content) =>
    content.replace(/^authors = \[[^\]]*\]/m, `authors = ["${author}"]`),
  );
}

for (const [relPath, content] of changed) {
  writeFileSync(join(root, relPath), content);
}

console.log(`\n  ${current.name} → ${displayName}`);
console.log(`  package/crate: ${current.slug} → ${slug}`);
console.log(`  identifier:    ${current.identifier} → ${identifier}`);
console.log(`  files written: ${changed.size}\n`);

// --- Prove it ------------------------------------------------------------

// Native projects are generated from the old identity and are git-ignored, so
// they are not renamed - they are regenerated. Saying so here is the difference
// between a clean rename and a phone with two apps on it.
const gen = join(root, "apps/shell/src-tauri/gen");
if (existsSync(gen)) {
  console.log(
    "  Note: apps/shell/src-tauri/gen/ was generated for the old identity. Delete it and\n" +
      "  re-run `pnpm mobile:android` / `pnpm mobile:ios` before building for a device.\n",
  );
}

try {
  execFileSync(process.execPath, [join(repoRoot, "scripts/check-template.mjs")], {
    stdio: "inherit",
  });
} catch {
  die("the rename left the template inconsistent (see above). This is a bug in rename.mjs.");
}

console.log("\n  Next: `pnpm install` (the workspace name changed), then `pnpm check`.\n");
