# Architecture

This template ships an **opinionated, machine-guarded** structure. The rules
below are enforced by `pnpm check` (see Enforcement) and by each package's
`exports` map — not by convention alone. Violations fail the build.

## Monorepo layout

```
apps/
  web/        React SPA + PWA (Vite). Thin shell: mounts the shared frontend.
  shell/      Tauri v2 native shell (desktop + iOS + Android). Also a thin shell.
  api/        Hono backend.
packages/
  client/     The SHARED frontend. web + shell both mount its <App>.
  db/         Drizzle schema + libSQL client factory.
  types/      Framework-free shared types.
  config/     Shared tsconfig bases.
```

Every package exposes one public entry (`exports: { ".": ... }`), so cross-package
**deep imports don't resolve** — you can only import the barrel.

## Frontend: feature-based (`packages/client/src`)

Group by feature, keep the base shared. Imports flow **downward only**.

| Folder | May import | Purpose |
|---|---|---|
| `app/` | features, components, lib | Root: providers, `<App>`, `mountApp`. Nothing imports `app`. |
| `features/` | components, lib | Self-contained capabilities. Each owns its `api`/`model`/`ui`. |
| `components/` | lib | Shared design-system components (Button, …). |
| `lib/` | (base) | Cross-cutting utilities (`cn`, api client). |

**Features are isolated** — one feature never imports another. Share by pushing
code down into `components/` or `lib/`. Compose features in `app/`.

## Backend: keep the domain pure (`apps/api/src`)

```
domain/   Business logic. Pure — no Hono, no Node, no DB. Defines the contracts.
infra/    Implementations of those contracts (system clock now; db/push later).
http/     The HTTP surface (Hono). Translates HTTP <-> domain.
index.ts  Wiring: build infra, inject into the domain, mount http, start server.
```

`domain/` must not import `infra/` or `http/`. New capabilities (data, push,
storage) arrive as a **new contract in `domain/` + a new implementation in
`infra/`** — the domain never changes shape to accommodate them. (If you like
the formal name, this is a domain/infrastructure split, a.k.a. ports & adapters.)

## Rust core (`apps/shell/src-tauri`)

Single crate, module-per-concern. `main.rs` is a thin entry; `lib.rs` holds
`run()`, shared by desktop and mobile, plus `ipc()` — the one place commands are
registered.

```
src/lib.rs              run() + ipc(): the command surface, declared once.
src/commands.rs         The commands themselves. Every one returns Result<T, Error>.
src/error.rs            The error taxonomy that crosses the boundary.
src/bin/export_bindings.rs   Generates the TypeScript bindings.
```

## The IPC boundary is generated, never hand-written

Nothing calls `invoke("some_string")`. `ipc()` is the single source of truth:
`run()` mounts it as the invoke handler and the generator exports it, so a
command cannot exist at runtime without also existing in TypeScript.

| File | Role |
|---|---|
| `apps/shell/src/bindings.ts` | **Generated.** Committed, never edited, excluded from Biome. |
| `apps/shell/src/ipc.ts` | The hand-written wrapper app code imports. Converts the generated `Result` into a thrown `IpcError`. |

Errors carry a stable `key`, not a sentence — the Rust core never decides what
the user reads, so the app stays translatable. `detail` is for logs.

The generated file is committed so a fresh clone can typecheck without a Rust
toolchain. `pnpm bindings:check` (part of `pnpm check`) regenerates and fails if
the result differs, which is what stops it going stale. Regenerate with
`pnpm bindings` after changing any command.

## Enforcement

`pnpm check` runs the whole gate (also in the pre-push hook + CI):

- `pnpm arch` — dependency-cruiser: the layer + boundary rules above (all apps/packages).
- `pnpm typecheck` / `pnpm lint` — tsc + Biome.
- `pnpm size` — no source file over 500 lines; ideal is ~150 (no dumping grounds).
- `pnpm dup` — jscpd copy/paste detector (no repeated logic).
- `pnpm knip` — no unused files, deps, or exports.
- `pnpm bindings:check` — the generated IPC bindings still match the Rust commands.
- `pnpm build` — also enforces the gzip bundle budgets (below).
- Package `exports` maps block deep imports across packages.

## Build output: what "normal" looks like

Every scaffolded app inherits these, so the defaults are tuned rather than left
at stock — and budgeted, because a one-time cleanup nothing enforces will drift.

| Thing | Expected | Guarded by |
|---|---|---|
| `apps/web` JS | ~116 kB gzip (budget 140) | `pnpm build` |
| `apps/shell` JS | ~122 kB gzip (budget 145) | `pnpm build` |
| CSS, either app | ~3.4 kB gzip (budget 8) | `pnpm build` |
| `src-tauri/target` after a debug build | ~1.5 GB | — |

The Rust target directory is large by nature and almost entirely debug
information: the built `app_lib.dll` is ~140 kB. `[profile.dev]` therefore emits
`line-tables-only` for this crate (backtraces keep real file:line, stepping and
variable inspection go) and nothing at all for dependencies, which took it from
3.4 GB to 1.5 GB at no cost in build time. `[profile.release]` optimises for
size, since a Tauri app is webview-bound rather than CPU-bound and binary size
is what users download.

`pnpm clean` reclaims all of it. Budgets live in `scripts/check-bundle-size.mjs`
and print measured-vs-limit on every build, so growth is visible as a trend
rather than only at the moment it breaks.

## Patterns that keep it scaling

- **DB schema:** one table per file under `packages/db/src/schema/`, re-exported
  from the barrel — the schema never becomes one giant file.
- **App entry:** every shell calls `mountApp()` from `@repo/client` — the mount
  boilerplate is written once, never copy-pasted per app.
- Split any file approaching the size cap into a folder of focused modules.

## Adding code

- New frontend feature: `pnpm gen feature` (emits a correct slice).
- New backend capability: add a contract in `domain/`, an implementation in
  `infra/`, wire it in `index.ts`.
