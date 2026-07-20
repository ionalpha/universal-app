import { spawn } from "node:child_process";
import { devEnv, ports, urls } from "./ports.mjs";

// One launcher for every dev flow. It resolves the derived ports once, then
// starts the API plus whichever frontend(s) the chosen target needs, all
// sharing the same environment so they agree on ports without any hardcoding.
//
//   node scripts/dev.mjs api     API only
//   node scripts/dev.mjs web     API + web SPA
//   node scripts/dev.mjs shell   API + shell (the Tauri webview host)
//   node scripts/dev.mjs all     API + web + shell   (default)
const target = process.argv[2] ?? "all";

const filters = {
  api: ["@repo/api"],
  web: ["@repo/api", "@repo/web"],
  shell: ["@repo/api", "@repo/shell"],
  all: ["@repo/api", "@repo/web", "@repo/shell"],
};

const selected = filters[target];
if (!selected) {
  console.error(`Unknown dev target "${target}". Use: web | shell | all`);
  process.exit(1);
}

console.log(`\n  api    ${urls.api}`);
if (selected.includes("@repo/web")) console.log(`  web    ${urls.web}`);
if (selected.includes("@repo/shell"))
  console.log(`  shell  ${urls.shell}  (hmr ${ports.shellHmr})`);
console.log("");

const env = devEnv();
const children = selected.map((pkg) =>
  spawn("pnpm", ["--filter", pkg, "dev"], { env, stdio: "inherit", shell: true }),
);

// Tear the whole group down together — if one dev server dies or the user hits
// Ctrl+C, don't leave orphaned processes squatting on the derived ports.
let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill();
  process.exit(code);
}

for (const child of children) {
  child.on("exit", (code) => shutdown(code ?? 0));
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
