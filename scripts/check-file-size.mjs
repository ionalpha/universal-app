#!/usr/bin/env node
// Fails if any source file exceeds the line cap, so no single file quietly
// becomes a dumping ground. Split an offender into a folder of focused modules.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// 500 = top of the healthy range (ideal ~150, traditional cap ~300). Only fires
// on genuinely oversized files. Override with MAX_FILE_LINES.
const MAX = Number(process.env.MAX_FILE_LINES ?? 500);
const ROOTS = ["apps", "packages"];
const EXTS = [".ts", ".tsx"];
const IGNORE = new Set(["node_modules", "dist", "dev-dist", "target", "gen", ".turbo"]);

/** @param {string} dir @param {string[]} out */
function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || IGNORE.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (EXTS.some((e) => entry.name.endsWith(e))) out.push(p);
  }
}

const files = [];
for (const root of ROOTS) walk(root, files);

const offenders = files
  .map((f) => ({ f: f.replace(/\\/g, "/"), lines: readFileSync(f, "utf8").split("\n").length }))
  .filter(({ lines }) => lines > MAX)
  .sort((a, b) => b.lines - a.lines);

if (offenders.length > 0) {
  console.error(
    `✗ file-size: ${offenders.length} file(s) over ${MAX} lines - split into focused modules:`,
  );
  for (const { f, lines } of offenders) console.error(`  ${lines}  ${f}`);
  process.exit(1);
}
console.log(`✔ file-size: all ${files.length} source files ≤ ${MAX} lines`);
