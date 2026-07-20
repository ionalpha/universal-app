# Universal App Template

A template for building one TypeScript app that runs on web, desktop (Windows, macOS, Linux), iOS, Android, and as an installable PWA. The frontend is shared across all targets, the stack is type-safe end to end, and the data layer works offline.

> Status: in development. This README describes the intended architecture; the scaffold is still being built.

## Platforms

| Surface | How | Offline |
|---|---|---|
| Web | Static SPA, deployed directly | via PWA |
| PWA | Installable web app (service worker) | yes |
| Desktop | Tauri v2 (Windows, macOS, Linux) | yes |
| iOS | Tauri v2 mobile | yes |
| Android | Tauri v2 mobile | yes |

A single React SPA renders on every surface. Tauri v2 provides the desktop and mobile shells from one Rust core, so bundles stay small.

## Stack

| Layer | Choice |
|---|---|
| Shell | Tauri v2 |
| Frontend | React, TypeScript, Tailwind |
| Build tool | Vite 8 (Rolldown) |
| UI system | shadcn/ui (Radix) |
| Routing | TanStack Router |
| State, data, forms | TanStack Query, Zustand, Zod, react-hook-form |
| Backend | Hono with Hono RPC |
| ORM | Drizzle |
| Local data | libSQL (SQLite) |
| Cloud DB and sync | Turso / libSQL embedded replicas |
| IPC | tauri-specta (typed Rust/TS bindings) |
| Auth | Better Auth |
| Payments | Stripe with RevenueCat |

## Features

- Auth: email, OAuth, magic-link, passkeys, 2FA, organizations, role-based access, account management (with GDPR export/delete), transactional email.
- Offline data and sync: encrypted local libSQL with bidirectional Turso sync and conflict handling.
- Push notifications: one API over APNs (iOS), FCM (Android), and Web Push/VAPID (PWA).
- Payments: Stripe on web and desktop, RevenueCat for cross-platform in-app purchases. Optional.
- i18n: react-i18next, RTL, localized native menus.
- Observability: rotating structured logs, crash reporting, consent-gated telemetry.
- Backend services: background jobs and scheduling, file/media storage, feature flags, remote config.
- Runtime UX: deep-linking and universal links, first-run onboarding, state restoration, native back navigation, offline/reconnect indicators.
- Optional vector search via libSQL native vectors or sqlite-vec (no separate database).

## Tooling

- Lint/format: Biome. Git hooks: lefthook. Architecture rules: ast-grep, jscpd.
- Types: strict `tsconfig`, ts-reset. Dependencies: pnpm catalogs, syncpack, knip, Renovate.
- Testing: Vitest (unit), Playwright (web/desktop E2E), Maestro (mobile E2E), `cargo test`.
- CI: reusable `rs-ci` and `ts-ci` workflows, Tauri build matrix, gitleaks, CodeQL, osv-scanner, size-limit, Lighthouse.
- Versioning: Changesets. Security: CSP, per-window Tauri capabilities and ACL.

## Structure (planned)

```
apps/
  web/        # React SPA + PWA (Vite)
  desktop/    # Tauri v2 shell (desktop + iOS + Android)
  api/        # Hono backend
packages/
  ui/         # shadcn/ui components
  types/      # shared TS types
  db/         # Drizzle schema
  config/     # tsconfig, tailwind, tokens
```

Monorepo: pnpm workspaces (catalogs) with Turborepo.

## Roadmap

- Phase 0: scaffold, typed IPC, security, DX, testing.
- Phase 1: one screen live across all targets.
- Phase 2: auth, data and sync, UI, push, payments, observability.
- Phase 3: build, sign, release, updater, app-store readiness, scaffold generator.

## License

MIT.
