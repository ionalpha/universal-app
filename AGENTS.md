# Agent guide

Read `ARCHITECTURE.md` first. The structure is enforced by `pnpm check` — if you
put code in the wrong layer, the build fails. Place code by these rules:

## Where code goes

- **Shared design-system component** (button, inputs): `packages/client/src/components/`
- **Cross-cutting util** (`cn`, api client): `packages/client/src/lib/`
- **A user-facing feature** (a screen capability, with its own api/model/ui): `packages/client/src/features/<name>/` — scaffold with `pnpm gen feature`
- **Providers / `<App>` / mount**: `packages/client/src/app/`
- **Backend business logic**: `apps/api/src/domain/` (keep it pure — no Hono/Node/DB)
- **Backend implementations** (DB, clock, push): `apps/api/src/infra/`
- **HTTP endpoints**: `apps/api/src/http/`
- **A DB table**: one file under `packages/db/src/schema/`, re-exported from its barrel.

## Import direction (never break these)

- Frontend: `app → features → components → lib` (downward only). Features never import each other.
- Backend: `http`/`infra → domain` (domain imports neither).
- Cross-package: import the package barrel (`@repo/client`), never a deep path.

## Before you finish

```
pnpm check
```

That runs typecheck + lint + arch + file-size + duplication + dead-code. All must
pass. Fix a boundary or size failure by moving/splitting code, not by suppressing
the rule.
