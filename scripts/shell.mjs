import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { devEnv, repoRoot, resolvePlan, writeState } from "./ports.mjs";

// Launches the shell (Tauri) app across native platforms with derived ports:
//   node scripts/shell.mjs desktop   →  tauri dev
//   node scripts/shell.mjs ios       →  tauri ios dev
//   node scripts/shell.mjs android   →  tauri android dev
const platform = process.argv[2] ?? "desktop";
const tauriArgs = platform === "desktop" ? ["dev"] : [platform, "dev"];

// Resolve ONCE here, then pin the answer for the dev.mjs we spawn below via
// DEV_PORT_BASE. If both probed independently they could settle on different
// blocks, and the Tauri overlay would point the window at a dead port.
const { ports, urls, base } = await resolvePlan();
writeState(base);

const env = devEnv({ ports, urls }, { DEV_PORT_BASE: String(base) });

// We start the API + shell Vite server OURSELVES (not via Tauri's
// beforeDevCommand) so there's no cwd/quoting guesswork — dev.mjs resolves the
// derived ports the same way Tauri's overlay does. Tauri then just waits for
// the devUrl to come up and opens the window.
const front = spawn("node", [join(repoRoot, "scripts", "dev.mjs"), "shell"], {
  cwd: repoRoot,
  env,
  stdio: "inherit",
  shell: false,
});

// Overlay points Tauri at this clone's shell port and disables its own
// beforeDevCommand (empty string = run nothing) since we already started it.
const overlay = { build: { devUrl: urls.shell, beforeDevCommand: "" } };
const overlayPath = join(tmpdir(), `universal-app.tauri.${ports.shell}.json`);
writeFileSync(overlayPath, JSON.stringify(overlay));

console.log(`\n  ${platform} → ${urls.shell}  (api ${urls.api})\n`);

// Use the package's `tauri` script (resolves the local CLI); pnpm forwards the
// trailing args to it.
const tauri = spawn(
  "pnpm",
  ["--filter", "@repo/shell", "tauri", ...tauriArgs, "--config", overlayPath],
  { cwd: repoRoot, env, stdio: "inherit", shell: true },
);

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  front.kill();
  tauri.kill();
  process.exit(code);
}

tauri.on("exit", (code) => shutdown(code ?? 0));
front.on("exit", (code) => shutdown(code ?? 0));
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
