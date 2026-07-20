/**
 * Machine-guarded architecture. `pnpm arch` fails the build on any violation.
 * Keep this file and ARCHITECTURE.md in the same vocabulary.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    // --- Frontend (packages/client): components/lib -> features -> app ---
    {
      name: "client-base-no-upward",
      comment: "components/ and lib/ are the base; they must not import features/ or app/.",
      severity: "error",
      from: { path: "^packages/client/src/(components|lib)/" },
      to: { path: "^packages/client/src/(features|app)/" },
    },
    {
      name: "client-features-no-app",
      comment: "features/ must not import the app/ composition layer.",
      severity: "error",
      from: { path: "^packages/client/src/features/" },
      to: { path: "^packages/client/src/app/" },
    },
    {
      name: "client-no-cross-feature",
      comment: "features are isolated slices; one feature must not reach into another.",
      severity: "error",
      from: { path: "^packages/client/src/features/([^/]+)/" },
      to: {
        path: "^packages/client/src/features/([^/]+)/",
        pathNot: "^packages/client/src/features/$1/",
      },
    },

    // --- Backend (apps/api): domain (pure) <- infra + http ---
    {
      name: "api-domain-pure",
      comment: "domain/ is framework-free; it must not depend on infra/ or http/.",
      severity: "error",
      from: { path: "^apps/api/src/domain/" },
      to: { path: "^apps/api/src/(infra|http)/" },
    },
    {
      name: "api-infra-no-http",
      comment: "infrastructure must not depend on the HTTP layer.",
      severity: "error",
      from: { path: "^apps/api/src/infra/" },
      to: { path: "^apps/api/src/http/" },
    },

    // --- Global hygiene ---
    {
      name: "no-circular",
      comment: "circular dependencies break layering and tree-shaking.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    exclude: { path: "node_modules|dist|dev-dist|\\.turbo|src-tauri" },
  },
};
