import { execFileSync } from "node:child_process";
import { ports, repoRoot, urls } from "./ports.mjs";

// Stops everything this clone left running, and ONLY this clone:
//   1. the dev servers (API/Vite) — found by their derived ports
//   2. the native shell binary (the Tauri window) — found by its executable
//      path living under THIS clone's root; it holds no port, so ports alone
//      would never catch it
// Both are scoped to this clone (derived ports + this repo's path), so it's
// safe to run blindly and won't disturb any other app or sibling clone. Used
// by `pnpm stop`.
const targets = [ports.api, ports.web, ports.shell, ports.shellHmr];
const isWindows = process.platform === "win32";

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8" });
  } catch {
    return "";
  }
}

function uniqPids(text) {
  return [...new Set(text.split(/\s+/).filter(Boolean))].filter(
    (pid) => Number(pid) && Number(pid) !== process.pid,
  );
}

// PIDs listening on one of our derived ports (the dev servers).
function pidsOnPort(port) {
  if (isWindows) {
    return uniqPids(
      run("powershell", [
        "-NoProfile",
        "-Command",
        `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess`,
      ]),
    );
  }
  return uniqPids(run("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"]));
}

// PIDs whose executable lives under this clone's root (the Tauri app binary,
// plus any lingering cargo/tauri build process). Path-scoped, so a sibling
// clone with the same binary name is never touched.
function pidsUnderRoot() {
  if (isWindows) {
    return uniqPids(
      run("powershell", [
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '${repoRoot}\\*' } | ForEach-Object { $_.ProcessId }`,
      ]),
    );
  }
  // Match the repo path anywhere in the command line, then drop this process.
  return uniqPids(run("pgrep", ["-f", repoRoot]));
}

function kill(pid) {
  try {
    if (isWindows) {
      // /T also kills the child tree (vite/tsx spawned under the launcher).
      execFileSync("taskkill", ["/PID", pid, "/F", "/T"], { stdio: "ignore" });
    } else {
      process.kill(Number(pid), "SIGTERM");
    }
    return true;
  } catch {
    return false;
  }
}

const pids = new Set();
for (const port of targets) for (const pid of pidsOnPort(port)) pids.add(pid);
for (const pid of pidsUnderRoot()) pids.add(pid);

let killed = 0;
for (const pid of pids) if (kill(pid)) killed++;

console.log(
  killed
    ? `\n  stopped ${killed} process(es) for this clone (ports ${targets.join(", ")} + app binary)\n`
    : `\n  nothing running for this clone (ports ${targets.join(", ")} + app binary)\n`,
);
console.log(`  urls were: ${urls.api}  ${urls.web}  ${urls.shell}\n`);
