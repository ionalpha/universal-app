import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

// Guards what users actually download. Runs as part of `pnpm build`, so the
// budget cannot be forgotten the way a separate command would be.
//
// Measured in gzip because that is what crosses the wire; raw bytes overstate
// the cost of repetitive code by roughly 3x here. Every entry prints its
// measurement next to its budget whether or not it passes, so a slow creep is
// visible long before it breaks the build. A gate that only speaks up at the
// moment of failure gives you no warning and no trend.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Budgets are gzip kB, set a little above today's measurement: enough headroom
// for ordinary feature work, tight enough that adding a heavy dependency has to
// be a decision rather than an accident. Raising one is fine - doing it
// knowingly, in a diff someone reviews, is the point.
const BUDGETS = [
  { app: "web", dist: "apps/web/dist", ext: ".js", budgetKb: 140 },
  { app: "web", dist: "apps/web/dist", ext: ".css", budgetKb: 8 },
  { app: "shell", dist: "apps/shell/dist", ext: ".js", budgetKb: 145 },
  { app: "shell", dist: "apps/shell/dist", ext: ".css", budgetKb: 8 },
];

function gzipKbOf(dir, ext) {
  const assets = join(repoRoot, dir, "assets");
  let total = 0;
  let found = 0;
  for (const name of readdirSync(assets)) {
    if (extname(name) !== ext) continue;
    const path = join(assets, name);
    if (!statSync(path).isFile()) continue;
    total += gzipSync(readFileSync(path)).length;
    found++;
  }
  return { kb: total / 1024, found };
}

let failed = 0;
console.log("\n  bundle budgets (gzip)\n");

for (const { app, dist, ext, budgetKb } of BUDGETS) {
  let measured;
  try {
    measured = gzipKbOf(dist, ext);
  } catch {
    // A missing dist means the build did not run or did not emit. Treating that
    // as a pass would make the gate silently vacuous, which is worse than noisy.
    console.error(
      `  FAIL  ${app}${ext}  no build output under ${dist}/assets - did the build run?`,
    );
    failed++;
    continue;
  }

  if (measured.found === 0) {
    console.error(`  FAIL  ${app}${ext}  no ${ext} assets found in ${dist}/assets`);
    failed++;
    continue;
  }

  const used = Math.round((measured.kb / budgetKb) * 100);
  const line = `${app}${ext}`.padEnd(12);
  const size = `${measured.kb.toFixed(1)} kB`.padStart(9);
  const limit = `${budgetKb} kB`.padEnd(7);
  if (measured.kb > budgetKb) {
    console.error(`  FAIL  ${line}${size} / ${limit} (${used}% of budget)`);
    failed++;
  } else {
    console.log(`  ok    ${line}${size} / ${limit} (${used}% of budget)`);
  }
}

if (failed) {
  console.error(
    "\n  Over budget. Either the growth is justified (raise the budget in" +
      " scripts/check-bundle-size.mjs, in the same commit) or it is not (find" +
      " what got pulled in).\n",
  );
  process.exit(1);
}

console.log("");
