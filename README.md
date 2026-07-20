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

Mobile is the *same* Tauri app as desktop (`apps/shell`); `tauri ios/android init`
generates native projects under `apps/shell/src-tauri/gen/` (git-ignored).

## Example files

Files marked `⚠️ EXAMPLE` (e.g. `packages/db/src/drizzle-example-repository.ts`,
`schema/example.ts`) exist to show a pattern. They are not wired into the running
app and create no cruft if ignored - copy the shape into your own code, then delete
them.

## License

MIT.
