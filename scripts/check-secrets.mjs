import { spawnSync } from "node:child_process";

// Pre-commit secret scan (wired in lefthook.yml). Runs gitleaks over the
// staged diff so a committed token never exists in history - once it does,
// rotation is the only fix, because a push publishes every commit it carries.
//
// Skips with a warning when gitleaks is not installed rather than failing:
// a template consumer without the binary should not be unable to commit, and
// CI runs the same scan authoritatively over the full history.

// No shell: gitleaks ships as a plain executable on every platform, and a
// direct spawn is what makes "not installed" (ENOENT) distinguishable from
// "found a secret" (exit 1).
const result = spawnSync(
  "gitleaks",
  ["git", "--pre-commit", "--staged", "--redact", "--no-banner"],
  {
    stdio: "inherit",
  },
);

if (result.error?.code === "ENOENT") {
  console.warn(
    "⚠ secrets: gitleaks is not installed, staged changes were NOT scanned.\n" +
      "  Install it (https://github.com/gitleaks/gitleaks#installing) - CI scans\n" +
      "  the pushed history either way, but by then a leaked token needs rotating.",
  );
  process.exit(0);
}

process.exit(result.status ?? 1);
