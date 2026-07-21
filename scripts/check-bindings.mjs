import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Fails if apps/shell/src/bindings.ts does not match the Rust command surface.
//
// The generated file is committed on purpose: the frontend typechecks against
// it, so CI and a fresh clone must not need a Rust toolchain just to run `tsc`.
// The cost of committing a generated file is that it can go stale, and this is
// the gate that stops that. Regenerate with `pnpm bindings`.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const crateDir = join(repoRoot, "apps", "shell", "src-tauri");
const bindingsPath = join(repoRoot, "apps", "shell", "src", "bindings.ts");

const before = readFileSync(bindingsPath, "utf8");

try {
  execFileSync("cargo", ["run", "--quiet", "--bin", "export_bindings"], {
    cwd: crateDir,
    stdio: "inherit",
  });
} catch {
  console.error(
    "\n  bindings: could not run the generator (is the Rust toolchain installed?)\n" +
      "  This check needs cargo. Skipping it silently would let drift through, so it fails instead.\n",
  );
  process.exit(1);
}

if (readFileSync(bindingsPath, "utf8") !== before) {
  console.error(
    "\n  bindings: apps/shell/src/bindings.ts was stale and has just been regenerated.\n" +
      "  A Rust command changed without its TypeScript binding being updated.\n" +
      "  Review the diff and commit it.\n",
  );
  process.exit(1);
}

console.log("✔ bindings: apps/shell/src/bindings.ts matches the Rust commands");
