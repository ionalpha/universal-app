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
`run()`, shared by desktop and mobile.

## Enforcement

`pnpm check` runs the whole gate (also in the pre-push hook + CI):

- `pnpm arch` — dependency-cruiser: the layer + boundary rules above (all apps/packages).
- `pnpm typecheck` / `pnpm lint` — tsc + Biome.
- `pnpm size` — no source file over 500 lines; ideal is ~150 (no dumping grounds).
- `pnpm dup` — jscpd copy/paste detector (no repeated logic).
- `pnpm knip` — no unused files, deps, or exports.
- Package `exports` maps block deep imports across packages.

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
