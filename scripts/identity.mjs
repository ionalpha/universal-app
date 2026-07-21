import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Where a clone's identity lives, in one table.
//
// A template is judged on what a fresh clone does, and the way clones break is
// always the same: the name is changed in the places you remember and left in
// the places you do not, until the two halves disagree and something refuses to
// build. The worst version of that is silent until the first compile: rename
// the lib crate out of step with the `::run()` call in main.rs and the app has
// no entry point at all.
//
// This table is read in both directions. `rename.mjs` writes every site from
// one display name; `check-template.mjs` reads every site back and fails if any
// of them disagrees with that name. Neither script keeps a list of "placeholder
// tokens to look for", because such a list rots the moment someone adds a
// thirteenth site - the check compares against the source of truth instead, so
// a site that drifts is caught by the same rule that created it.

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The display name is the source of truth; the slug is derived from it, never
 * stored independently. npm package names and Cargo package names accept the
 * same shape, so one slug serves both.
 */
export function slugify(name) {
  return name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Escapes a value that is about to be interpolated into a RegExp. */
export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The launcher-safe short form: Android truncates past ~12 characters. */
export function shortNameFor(name) {
  const first = name.split(/\s+/)[0];
  return first.length <= 12 ? first : first.slice(0, 12);
}

/** A placeholder org, so the shape is right and the value is obviously yours to set. */
export function defaultIdentifier(slug) {
  return `com.example.${slug.replace(/-/g, "")}`;
}

// Java keywords are illegal as Android package segments, and the bundle
// identifier becomes the Android package. Kotlin adds `object`/`fun`/`val`,
// which are equally fatal in generated Kotlin.
const RESERVED_SEGMENTS = new Set([
  "abstract",
  "assert",
  "boolean",
  "break",
  "byte",
  "case",
  "catch",
  "char",
  "class",
  "const",
  "continue",
  "default",
  "do",
  "double",
  "else",
  "enum",
  "extends",
  "final",
  "finally",
  "float",
  "for",
  "fun",
  "goto",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "int",
  "interface",
  "is",
  "long",
  "native",
  "new",
  "object",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "short",
  "static",
  "strictfp",
  "super",
  "switch",
  "synchronized",
  "this",
  "throw",
  "throws",
  "transient",
  "try",
  "val",
  "var",
  "void",
  "volatile",
  "while",
]);

/**
 * Returns a list of reasons the bundle identifier is unusable, empty if it is
 * fine. Every rule here is a real build or store failure, not style.
 */
export function identifierProblems(identifier) {
  const problems = [];
  const segments = identifier.split(".");
  if (segments.length < 2) {
    problems.push("needs at least two segments (reverse-DNS, e.g. com.acme.myapp)");
  }
  for (const segment of segments) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(segment)) {
      problems.push(
        `segment "${segment}" must start with a letter and contain only letters, ` +
          "digits and underscores (hyphens are legal on Apple but not in an Android package)",
      );
    } else if (RESERVED_SEGMENTS.has(segment)) {
      problems.push(`segment "${segment}" is a Java/Kotlin keyword, illegal as an Android package`);
    }
  }
  if (identifier.endsWith(".app")) {
    problems.push('must not end in ".app": macOS bundling collides with the .app directory');
  }
  if (identifier === "com.tauri.dev") {
    problems.push("is the Tauri scaffold default, which no store will accept");
  }
  return problems;
}

// `field` says which value the site must hold: the display name, or its slug.
// `rule` relaxes exact equality where the site legitimately carries more than
// the name (a README heading) or less (a launcher short name).
export const SITES = [
  {
    file: "package.json",
    what: "the workspace name",
    field: "slug",
    pattern: /^ {2}"name": "([^"]+)"/m,
  },
  {
    file: "apps/shell/src-tauri/Cargo.toml",
    what: "the crate name",
    field: "slug",
    pattern: /^\[package\]\nname = "([^"]+)"/m,
  },
  {
    file: "apps/shell/src-tauri/Cargo.toml",
    what: "the crate description",
    field: "name",
    pattern: /^description = "([^"]+)"/m,
  },
  {
    // Tauri's dev command shells out to a bare `cargo run`, which cannot choose
    // between the app and the bindings generator without this.
    file: "apps/shell/src-tauri/Cargo.toml",
    what: "the default binary",
    field: "slug",
    pattern: /^default-run = "([^"]+)"/m,
  },
  {
    file: "apps/shell/src-tauri/tauri.conf.json",
    what: "the product name",
    field: "name",
    pattern: /"productName": "([^"]+)"/,
  },
  {
    file: "apps/shell/src-tauri/tauri.conf.json",
    what: "the main window title",
    field: "name",
    pattern: /"title": "([^"]+)"/,
  },
  {
    file: "apps/shell/index.html",
    what: "the document title",
    field: "name",
    pattern: /<title>([^<]+)<\/title>/,
  },
  {
    file: "apps/web/index.html",
    what: "the document title",
    field: "name",
    pattern: /<title>([^<]+)<\/title>/,
  },
  {
    file: "apps/web/vite.config.ts",
    what: "the PWA manifest name",
    field: "name",
    pattern: /manifest: \{\s*\n\s*name: "([^"]+)"/,
  },
  {
    file: "apps/web/vite.config.ts",
    what: "the PWA short name (what an installed icon is labelled)",
    field: "name",
    rule: "shortName",
    pattern: /short_name: "([^"]+)"/,
  },
  {
    file: "packages/client/src/app/app-name.ts",
    what: "the in-app brand",
    field: "name",
    pattern: /export const APP_NAME = "([^"]+)"/,
  },
  {
    file: "README.md",
    what: "the title",
    field: "name",
    rule: "startsWith",
    pattern: /^# (.+)$/m,
  },
];

/** The value a site currently holds, or null if the site has been restructured away. */
export function readSite(site, root = repoRoot) {
  const match = site.pattern.exec(readFileSync(join(root, site.file), "utf8"));
  return match ? match[1] : null;
}

/** What a site is required to hold, given the display name. */
export function expectedFor(site, name) {
  if (site.rule === "shortName") return shortNameFor(name);
  return site.field === "slug" ? slugify(name) : name;
}

/** Whether the value a site holds satisfies its rule. */
export function siteHolds(site, value, name) {
  const expected = expectedFor(site, name);
  if (site.rule === "startsWith") return value.startsWith(name);
  if (site.rule === "shortName") return name.startsWith(value) && value.length <= 12;
  return value === expected;
}

/**
 * Rewrites one site's value in place. The pattern matches a single short
 * construct, so replacing the captured value inside the match cannot touch
 * anything else in the file.
 */
export function writeSite(content, site, next) {
  // Both replacements take a function, so a `$&` or `$1` in a product name is
  // written literally instead of being read as a substitution pattern.
  return content.replace(site.pattern, (match, value) => match.replace(value, () => next));
}

/** The identity a working tree currently claims. */
export function readIdentity(root = repoRoot) {
  const tauriConf = JSON.parse(
    readFileSync(join(root, "apps/shell/src-tauri/tauri.conf.json"), "utf8"),
  );
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return {
    name: tauriConf.productName,
    slug: pkg.name,
    identifier: tauriConf.identifier,
  };
}
