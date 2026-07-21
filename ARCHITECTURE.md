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

## API security: the allowlist is derived, not typed

A wildcard CORS policy would let every page on the internet call the API from a
logged-in user's browser, so the allowlist is explicit and nothing falls back to
`*`. The API takes an `ApiConfig` resolved at the composition root
(`infra/config.ts`) and never reads the environment below that:

- `ALLOWED_ORIGINS` is derived in dev by `scripts/ports.mjs`, from the same port
  plan that produces the CSP. Nothing is hand-maintained.
- The shell's own origins (`tauri://localhost` and the Windows http(s)
  equivalents) are always allowed. A bundled app has no configurable origin, so
  a deployment should not have to know them.
- **In production an unset `ALLOWED_ORIGINS` throws at startup.** A deployment
  that refuses to boot is a page; one that silently serves every origin is a
  breach nobody notices.

On top of that: `secureHeaders`, `csrf` (a cross-origin form post is a simple
request - no preflight, so CORS never gets asked), `bodyLimit` and `timeout`.
One deliberate deviation from Hono's defaults, in `http/security.ts`:
`Cross-Origin-Resource-Policy` is `cross-origin`, not the default `same-origin`,
which would block this API's own clients - the web app and shell are
cross-origin by construction.

Ten tests in `app.e2e.test.ts` assert the *behaviour*, not the config, so they
fail when a control is removed and removing one is a visible act.

## Webview security: assume the frontend is hostile

A Tauri window is a browser with a bridge to native code behind it. Treat the
frontend as the untrusted half - a compromised dependency runs there - and the
question becomes: what can it reach? Three answers, all enforced by
`pnpm security`.

**An enforced CSP.** With no policy (Tauri accepts `csp: null`), injected
script can load from anywhere and talk to anywhere. The policy here is
`default-src 'self'` with `object-src`, `frame-src`, `child-src`,
`frame-ancestors` and `form-action` at `'none'`, and `connect-src` as an
explicit allowlist. Tauri appends a nonce or hash to `script-src` and
`style-src` for the built assets, which is why production never needs
`'unsafe-inline'`.

| Where | Applies to | Source |
|---|---|---|
| `tauri.conf.json` `app.security.csp` | The bundled app | Written out, so it is readable without running anything |
| `apps/shell/vite.config.ts` `server.headers` | Desktop dev | `devCsp()` in `scripts/csp.mjs` |
| `shell.mjs` overlay `devCsp` | iOS/Android dev | `devCsp()` in `scripts/csp.mjs` |
| `apps/web/vite.config.ts` `server.headers` | Web dev | `webCsp()` in `scripts/csp.mjs` |
| `apps/web/dist/_headers` | Web production | `webHeadersFile()`, emitted at build |

Five places because each is a different delivery mechanism, not a different
policy. In desktop dev the webview loads straight from Vite and Tauri never
touches the response; on mobile the dev server is proxied through Tauri's own
protocol; a static SPA has no server of its own at all, so its policy ships as a
file the host reads. They all come from one function, so they cannot enforce
different rules, and `pnpm security` diffs the written-out production policy
against that function directive by directive.

The dev policies name the checkout's own derived ports (see the port scheme in
the README) rather than using `http://localhost:*`, which would silently admit
every other dev server on the machine.

**The browser target gets the same treatment, deliberately.** Its threat model
is worse than the webview's - real cross-origin pages, real extensions, a real
URL bar - so a weaker policy there would be backwards. It differs only in that
it drops the IPC sources (no Rust core behind a browser tab) and adds the API
origin. `_headers` is the Netlify and Cloudflare Pages format; other hosts need
it translated (see README), which is why the file is emitted rather than
described.

`connect-src` names the exact API origin the bundle will call, so building
without `VITE_API_URL` set produces a build warning rather than a deployed app
whose own API is blocked by its own policy.

Dev enforcing a policy at all is the point: without it, the strict production
CSP is first exercised by a release build.

**Capabilities that grant nothing.** `capabilities/default.json` holds an empty
permission list. The capability ACL only brokers *plugin* commands, and the
frontend calls none: every native call goes through the app commands in
`commands.rs`, which the ACL does not broker, and the opener plugin is only
ever invoked from Rust (so the webview has no grant for it and its JS half is
not a dependency). A grant like `core:default` would expose roughly a hundred
IPC commands nothing uses.

**Locked-down protocol headers.** `app.security.headers` sets the non-CSP
response headers on Tauri's own protocol: `Cross-Origin-Opener-Policy` and
`-Resource-Policy` at `same-origin`, `Cross-Origin-Embedder-Policy` at
`require-corp` (the API opts in by serving CORS approval plus
`Cross-Origin-Resource-Policy: cross-origin`), `nosniff`, and a
Permissions-Policy that denies the powerful browser features by name - by
name because the spec has no deny-everything token; `*=()` is invalid syntax
that browsers skip silently. The values live in `hardenedHeaders()` in
`scripts/csp.mjs`, which the shell dev server also sends, so COEP - the one
header that can break a working fetch - would break in dev, not in a release
build. The written-out copy in `tauri.conf.json` is diffed against the
function by `pnpm security`.

**Brownfield over Isolation, decided rather than defaulted.** Tauri's docs
recommend the Isolation pattern - a sandboxed iframe that can inspect IPC
messages before the Rust core sees them, aimed at compromised frontend
dependencies. This template stays on Brownfield, for two reasons. First, the
protection is only as good as the validation logic written into the isolation
hook, and against a three-command IPC surface with zero plugin permissions
there is nothing meaningful for that hook to reject that the ACL and the
generated bindings do not already constrain. Second, Isolation requires an
iframe, and this CSP sets `frame-src`/`child-src` to `'none'` - which closes
the remote-iframe IPC-bypass class (GHSA-57fm-592m-34r7) outright. Trading a
structural exclusion for an inspection layer with no rules would be a
downgrade wearing a recommended-practice label. Revisit if the command
surface grows past easy audit or a plugin permission is ever granted; the
compromised-dependency threat itself is answered upstream by the supply-chain
controls (below) and the bundle secret scan.

**A guard, because the regression is silent.** Nothing breaks when a CSP goes
back to null or `core:default` gets pasted in to unblock an afternoon; the app
keeps running and the surface just grows. `pnpm security` fails on a null or
drifted CSP, `'unsafe-eval'`, a wildcard or bare-scheme source, a capability
that targets `"*"` or names no window, a capability file not listed in
`app.security.capabilities`, any permission outside `ALLOWED_PERMISSIONS` in
`scripts/check-security.mjs`, drifted or missing protocol headers, an
`envPrefix` beyond `VITE_`/`TAURI_ENV_*`, a Vite version below the patched
floor, and the `devtools` cargo feature (which would compile the inspector
into release builds). Everything fails closed, so widening the surface takes
an edit that shows up in review. `pnpm security --print` prints both
policies.

## Supply chain: block at install time, audit on a clock

An npm compromise runs code on the machine at install; an advisory tells you
about it afterwards. The controls are split accordingly.

**Install-time, in `pnpm-workspace.yaml`** (each with its reason inline):
`minimumReleaseAge` (a compromised release is usually yanked within hours;
a 3-day cooldown lets the ecosystem catch it first), `trustPolicy:
no-downgrade` (a version whose publishing auth is weaker than its
predecessor's is the shape of an account takeover; exclusions are listed with
a review note each), `onlyBuiltDependencies: []` (no dependency runs install
scripts - the platform-binary packages all use optionalDependencies instead),
and `verifyDepsBeforeRun` (scripts refuse a node_modules that drifted from the
lockfile).

**Audits, in CI and on a schedule - deliberately not in `pnpm check`.** The
advisory database changes while the code does not, so a per-push audit both
misses new advisories between pushes and fails pushes for unrelated reasons;
a network-dependent pre-push hook is one that gets bypassed. `pnpm audit:deps`
runs the same audits locally: `pnpm audit` for JS, `cargo audit --deny
warnings` (without `--deny` it exits 0 over findings) and `cargo deny check`
(licences, sources, wildcard versions) for the Rust crate. Ignored advisories
live in `apps/shell/src-tauri/.cargo/audit.toml` with a reason and review date
each - a time-boxed mute, not a permanent one.

## Enforcement

`pnpm check` runs the whole gate (also in the pre-push hook + CI):

- `pnpm arch` - dependency-cruiser: the layer + boundary rules above (all apps/packages).
- `pnpm typecheck` / `pnpm lint` - tsc + Biome.
- `pnpm size` - no source file over 500 lines; ideal is ~150 (no dumping grounds).
- `pnpm dup` - jscpd copy/paste detector (no repeated logic).
- `pnpm knip` - no unused files, deps, or exports.
- `pnpm bindings:check` - the generated IPC bindings still match the Rust commands.
- `pnpm security` - the webview CSP and capability grants have not been widened (above).
- `pnpm build` - also enforces the gzip bundle budgets (below).
- Package `exports` maps block deep imports across packages.

## Build output: what "normal" looks like

Every scaffolded app inherits these, so the defaults are tuned rather than left
at stock - and budgeted, because a one-time cleanup nothing enforces will drift.

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
