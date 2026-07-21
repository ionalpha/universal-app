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
| iOS / Android | Tauri v2 mobile (one project) | Android builds + runs; iOS needs a Mac |

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

### Android toolchain

The Android target builds with exactly this set (undocumented mobile setup is
the usual reason a "universal" template is not universal in practice):

- **JDK 17** (Temurin) - `sdkmanager` and the Android Gradle Plugin both
  require it. Set `JAVA_HOME`.
- **Android SDK** via command-line tools: `platform-tools`,
  `platforms;android-34`, `build-tools;34.0.0`, `ndk;26.3.11579264`. Set
  `ANDROID_HOME` to the SDK root and `NDK_HOME` to the NDK directory, and
  accept licenses once with `sdkmanager --licenses`.
- **Rust Android targets**: `rustup target add aarch64-linux-android
  armv7-linux-androideabi i686-linux-android x86_64-linux-android`.

Two Windows-specific traps, both fatal and neither obvious from the error's
distance to its cause:

- `tauri.conf.json` `version` must be `0.0.1` or higher - Android rejects
  `0.0.0` at build time.
- **Developer Mode must be on** (Settings → System → For developers). The
  build symlinks the compiled `.so` into the Gradle project and Windows
  denies symlink creation without it.

`tauri android build --debug --target aarch64` produces the device APK;
add `--target x86_64` for an emulator image, since the emulator runs the
host architecture. Artifacts land under
`apps/shell/src-tauri/gen/android/app/build/outputs/`. iOS requires a Mac
with Xcode and remains unproven until that hardware exists.

**Environment variables have a hard public/private boundary.** A `VITE_` prefix
means *public, permanently, on every platform*: Vite inlines it into the bundle,
which is served to every browser and unpacked from every app-store binary just
as easily. Everything else (`DATABASE_URL`, `TURSO_AUTH_TOKEN`, ...) stays
server-side and must never gain the prefix to "make something work" - move the
call behind the API instead. Three guards enforce this: `pnpm security` rejects
any widened `envPrefix` in the Vite configs, `pnpm build` scans the actual
output for secret shapes and for the values of non-`VITE_` variables, and the
pre-commit hook runs gitleaks over the staged diff (skipped with a warning if
not installed).

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

All targets - desktop, mobile, browser - enforce a Content Security Policy
generated by one function in `scripts/csp.mjs`, in dev and in production:
`default-src 'self'`, `object-src`/`frame-ancestors`/`form-action` at `'none'`,
and `connect-src` as an explicit allowlist.

- **Shell**: `capabilities/default.json` grants no plugin permissions to the
  webview. Native calls go through the app commands in `commands.rs` only.
- **Web**: the production build emits `dist/_headers` (Netlify / Cloudflare
  Pages format) with the CSP plus HSTS, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy` and the cross-origin headers. On other
  hosts, translate it: `vercel.json` `headers`, an nginx `add_header` block, or
  your CDN's rules.
- **API**: CORS is an origin allowlist read from `ALLOWED_ORIGINS`. In
  production the API refuses to start if it is unset; in dev it is filled in
  automatically with the ports above. Secure headers, CSRF protection, a body
  limit and a request timeout are on by default.

`pnpm security` (part of `pnpm check`) fails if any of this is loosened: a
disabled or edited CSP, a wildcard source, a capability grant outside the
allowlist. `pnpm security --print` shows every policy.

**Dev servers stay off the network.** Vite and the API bind loopback; only
on-device mobile dev needs more, so setting `TAURI_DEV_HOST` widens both binds
and prints exactly which ports just became reachable by everyone on the
network. The dev servers treat that network as hostile either way: explicit
`allowedHosts` (blocks DNS rebinding), CORS off, and a strict serving
allow-list with `.env*`, `*.pem`, `.dev-ports.json` and `src-tauri/` denied by
name. `pnpm security` also enforces a minimum Vite version, since dev-server
file-read vulnerabilities recur and a downgrade would reintroduce a patched
one silently.

**Supply chain.** `pnpm-workspace.yaml` turns on pnpm's supply-chain controls
(all opt-in on pnpm 10): a 3-day cooldown before newly published versions
resolve (`minimumReleaseAge`), publisher trust checks
(`trustPolicy: no-downgrade`), an empty install-script allowlist
(`onlyBuiltDependencies: []` - nothing in the tree needs one), and
lockfile-verified runs (`verifyDepsBeforeRun`). `pnpm audit:deps` runs
`pnpm audit` plus `cargo audit`/`cargo deny` against the Rust crate; the cargo
policies live in `apps/shell/src-tauri/deny.toml` and `.cargo/audit.toml`, and
every ignored advisory has a written reason and review date. Audits run in CI
and on a schedule rather than in `pnpm check`: the advisory database changes
while your code does not, and a network-dependent pre-push hook is one that
gets bypassed. The cargo half needs
[`cargo-audit`](https://github.com/rustsec/rustsec) and
[`cargo-deny`](https://github.com/EmbarkStudios/cargo-deny) installed.

**When you point the apps at a real backend**, set `VITE_API_URL` at build time
so the web CSP allows that origin (the build warns if it is unset), and add the
origin to `connect-src` in `app.security.csp`
(`apps/shell/src-tauri/tauri.conf.json`) for the desktop app. If you add
anything else that loads from another origin, widen `cspDirectives()` in
`scripts/csp.mjs` so dev and production stay in step. See
[ARCHITECTURE.md](ARCHITECTURE.md) for the full model, and
[SECURITY.md](SECURITY.md) for the threat model and how to report a
vulnerability.

## Example files

Files marked `⚠️ EXAMPLE` (e.g. `packages/db/src/drizzle-example-repository.ts`,
`schema/example.ts`) exist to show a pattern. They are not wired into the running
app and create no cruft if ignored - copy the shape into your own code, then delete
them.

## License

MIT.
