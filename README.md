# Universal App Template

A **highly opinionated, machine-guarded** starter for building **one** TypeScript app
that runs on web, desktop (Windows/macOS/Linux), iOS, Android, and as an installable
PWA - all from a single shared frontend.

This is not a neutral boilerplate. The stack is **decided**, the architecture is
**enforced by tooling (not docs)**, and every choice is deliberate. If you want a
blank canvas, this isn't it. If you want strong defaults and a paved road that keeps
an AI or a team from degrading the structure as it grows - this is that.

## Why opinionated

- **One toolchain, four platforms.** Tauri v2 (not Electron, not Capacitor) is the
  single native shell for desktop *and* mobile; the web target is the same SPA with
  no shell. One core, one frontend, one mental model.
- **Enforced structure, not suggested.** `pnpm check` fails the build on a crossed
  layer boundary, an oversized file, duplicated logic, or dead code. Boundaries are
  real, not aspirational. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) and
  [`AGENTS.md`](./AGENTS.md).
- **Type-safe end to end.** TypeScript everywhere, one shared type package, Zod at
  the edges, typed IPC (planned) - the compiler is the contract.

## Platforms

| Surface | How | Offline |
|---|---|---|
| Web | Static SPA, deployed directly | via PWA |
| PWA | Installable web app (service worker) | yes |
| Desktop | Tauri v2 (Windows, macOS, Linux) | planned |
| iOS / Android | Tauri v2 mobile (one project) | planned |

A single React SPA renders on every surface. Tauri provides desktop + mobile from
one Rust core, so bundles stay small.

## The stack (decided)

| Layer | Choice |
|---|---|
| Shell | Tauri v2 |
| Frontend | React 19, TypeScript, Tailwind v4 |
| Build tool | Vite 8 (Rolldown) |
| UI | shadcn-style components (Base UI is shadcn's 2026 default) |
| State / data / forms | Zustand, TanStack Query, Zod, react-hook-form |
| Backend | Hono |
| ORM / data | Drizzle + libSQL (local) ⇄ Turso (cloud) |
| Monorepo | pnpm workspaces (catalogs) + Turborepo |
| Lint/format · hooks | Biome · lefthook |
| Guards | dependency-cruiser · jscpd · knip · file-size cap |

Roadmap layers keep the same discipline: typed IPC (tauri-specta), Auth (Better
Auth), Payments (Stripe + RevenueCat), push (APNs/FCM), i18n, observability.

## Enforced architecture

`pnpm check` (also the pre-push hook) runs the full gate:

- **`arch`** - dependency-cruiser: frontend `components/lib → features → app`
  (downward only, features isolated); backend `domain` stays pure, `infra`/`http`
  depend on it - never the reverse.
- **`typecheck` · `lint`** - tsc + Biome.
- **`size`** - no source file over 500 lines (ideal ~150).
- **`dup`** - jscpd: no copy-pasted logic.
- **`knip`** - no unused files, deps, or exports.
- **`security`** - the Tauri webview stays locked down (see below).

Add a feature with `pnpm gen feature` - the generator emits a correct slice.

## What's built today

- Monorepo + all six guards green; both frontends build; the Tauri Rust core compiles.
- Shared frontend (`packages/client`) with a P1 design system: theme (light/dark/
  system), buttons/inputs/card/badge/spinner, layout primitives, app shell + page
  header, loading/empty/error states, a Zod-driven **form kit**, and toasts.
- Hono API (`apps/api`) with a clean `domain / infra / http` split (health + echo).
- Example data layer (`packages/db`) - Drizzle + libSQL, clearly marked example
  files you delete or replace. **Nothing creates a schema for you.**

## Structure

```
apps/
  web/        # React SPA + PWA (Vite)
  shell/      # Tauri v2 native shell (desktop + iOS + Android)
  api/        # Hono backend (domain / infra / http)
packages/
  client/     # shared frontend (components, lib, features, app)
  db/         # Drizzle schema + libSQL client (example only)
  types/      # shared types (client <-> api contracts)
  config/     # shared tsconfig
```

## Development

Prerequisites: Node 22+, pnpm 10+, and the Rust toolchain for desktop/mobile
(see [Tauri prerequisites](https://tauri.app/start/prerequisites/)).

```bash
pnpm install
cp .env.example .env

pnpm dev                # api + web + shell-vite together
pnpm dev:web            # api + web SPA
pnpm dev:api            # api only
pnpm desktop            # launch the Tauri desktop window (starts api + shell itself)
pnpm mobile:ios         # iOS simulator   (first run: pnpm --filter @repo/shell tauri ios init)
pnpm mobile:android     # Android emulator (first run: pnpm --filter @repo/shell tauri android init)

pnpm ports              # print this clone's derived ports/URLs
pnpm stop               # stop everything this clone started (dev servers + app window)

pnpm check              # typecheck + lint + arch + size + dup + knip
pnpm build              # production build
```

Just run `pnpm desktop` - it's self-contained: it starts the API and the shell
Vite server itself, then opens the native window pointed at them. Same for
`pnpm dev` / `pnpm dev:web` (Ctrl+C stops them; `pnpm stop` clears anything left
over, including the desktop window, which holds no port).

### Dynamic ports (run many clones at once)

Ports are **derived, never fixed** - `scripts/ports.mjs` hashes the repo path into
a unique block of four (`api`, `web`, `shell`, `shell` HMR), so every clone of this
template gets its own non-overlapping ports and you can run several side by side
with no collisions. `pnpm ports` shows the plan; the launchers inject them into the
API (`PORT`), Vite (`*_PORT`), and the frontends (`VITE_API_URL`) automatically.
Nothing is hardcoded to a port number.

Blocks land in `10000..31990`, below the 32768 floor where Linux starts handing
out ephemeral ports (Windows and macOS start at 49152, and additionally reserve
blocks up there for Hyper-V and WSL that nothing can bind at all).

The block is **probed before use**, not assumed: if anything already holds one of
the four ports, the run shifts to the next free block and says so. Probing never
changes the answer when the ports are free, so your URLs stay the same run to run.
The block a run settles on is recorded in `.dev-ports.json` (git-ignored) so
`pnpm stop` targets the ports actually in use rather than the ones that were
derived. Set `DEV_PORT_BASE` to pin a block explicitly and skip the search.

Mobile is the *same* Tauri app as desktop (`apps/shell`); `tauri ios/android init`
generates native projects under `apps/shell/src-tauri/gen/` (git-ignored).

### Security

Most Tauri starters ship `security.csp: null`, which turns the policy off. This
one ships a real one on **every** target - desktop, mobile and browser -
generated from a single function in `scripts/csp.mjs` so they cannot drift:
`default-src 'self'`, `object-src`/`frame-ancestors`/`form-action` at `'none'`,
and `connect-src` as an explicit allowlist.

- **Shell**: `capabilities/default.json` grants **no** plugin permissions. Every
  native call is an app command in `commands.rs`, and those are not brokered by
  the ACL, so the scaffold's `core:default` + `opener:default` were ~100 IPC
  commands nothing called.
- **Web**: the production build emits `dist/_headers` (Netlify / Cloudflare
  Pages format) with the CSP plus HSTS, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy` and the cross-origin headers. On other
  hosts, translate it: `vercel.json` `headers`, an nginx `add_header` block, or
  your CDN's rules.
- **API**: an origin allowlist that **refuses to start** in production if
  `ALLOWED_ORIGINS` is unset, rather than falling back to `*`. Plus secure
  headers, CSRF, a body limit and a request timeout.

Dev enforces the same policies against this clone's derived ports, so you find
out about a blocked request while writing the code rather than at release.
`pnpm security` (part of `pnpm check`) fails on a null or drifted CSP, a
wildcard source, or any permission not on its allowlist; `pnpm security --print`
shows every policy.

**When you point this at a real backend**, set `VITE_API_URL` at build time -
the CSP allows exactly the origin the bundle will call, and the web build warns
if you do not. For the desktop app, add the origin to `connect-src` in
`app.security.csp` (`apps/shell/src-tauri/tauri.conf.json`), which currently
lists the template's default `http://localhost:8787`. If you add anything that
loads from another origin, widen `cspDirectives()` in `scripts/csp.mjs` so dev
and production stay in step. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full
model.

## Example files

Files marked `⚠️ EXAMPLE` (e.g. `packages/db/src/drizzle-example-repository.ts`,
`schema/example.ts`) exist to show a pattern. They are not wired into the running
app and create no cruft if ignored - copy the shape into your own code, then delete
them.

## License

MIT.
