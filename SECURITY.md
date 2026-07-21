# Security

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's security advisories:
**Security → Report a vulnerability** on this repository. Do not open a
public issue for anything exploitable.

Expect an acknowledgement within 72 hours and a fix or a written assessment
within 30 days. Only the latest release (and `main`) is supported; this is a
template, so a fix usually means a patch here plus a note for apps already
scaffolded from it.

## Threat model

The app is the same frontend delivered four ways: a Tauri webview on desktop
and mobile, and a plain browser tab on the web. Threats follow the app's
lifecycle: what runs at install, at start, at run, and at update. Four trust
boundaries cover them. For each: what is assumed, and which control holds the
line. Every control listed here fails closed and is enforced by `pnpm check`
or the build; removing one breaks a named test, not just a promise.

### 1. Webview → Rust core (IPC)

Everything inside the webview is assumed compromisable: a dependency, an
injected string, a malicious link. The Rust core is the trusted side.

- The IPC surface is three commands, generated into typed bindings
  (`pnpm bindings:check` fails if they drift from the Rust source).
- Zero plugin permissions are granted. The capability file names its window
  explicitly, and `ALLOWED_PERMISSIONS` in `scripts/check-security.mjs` is
  empty on purpose: granting one is a reviewed edit to the guard itself.
- The CSP is real on every target and generated from one function
  (`scripts/csp.mjs`), with `frame-src 'none'` closing the remote-iframe IPC
  bypass class. Brownfield over Isolation is a recorded decision
  (ARCHITECTURE.md), not a default.
- `freezePrototype` is on, hardened protocol headers ship in
  `tauri.conf.json`, and the `devtools` cargo feature is banned from release
  builds.
- Enforced by: `pnpm security`, tamper-tested in
  `scripts/check-security.test.mjs`.

### 2. Client → API

Every client is untrusted: the API cannot tell the shipped frontend from
`curl`. The API validates, the client merely asks.

- CORS answers only an allowlist derived from configuration; production
  refuses to start without `ALLOWED_ORIGINS`, never answers with a wildcard,
  and rejects localhost origins outside development.
- CSRF protection covers the form-post path CORS does not, responses carry
  the security header set, and request bodies have a size limit.
- Enforced by: the `api security` suite in `apps/api/src/app.e2e.test.ts`.

### 3. Build machine → published artifact

Dependencies run code on the build machine at install time, and whatever the
build emits ships to every user.

- Install-time: 3-day `minimumReleaseAge`, `trustPolicy: no-downgrade`, no
  dependency install scripts, and `verifyDepsBeforeRun` (all in
  `pnpm-workspace.yaml`, each with its reason inline).
- Audit-on-a-clock: `pnpm audit:deps` runs `pnpm audit`, `cargo audit
  --deny warnings`, and `cargo deny check`; ignored advisories carry a
  reason and a review date.
- No secret reaches a client bundle: Vite's `envPrefix` is pinned to public
  prefixes (config guard) and every `dist/` is scanned for secret shapes and
  private environment values (build gate).
- Enforced by: `pnpm security`, the scan in `pnpm build`, tamper-tested in
  `scripts/check-bundle-secrets.test.mjs`.

### 4. Update server → installed app

An auto-updater is a signed pipe that runs code on every user's machine. No
updater is configured, and that is the decision, not an omission. The trust
requirements for enabling one (key custody, HTTPS-only endpoint, signature
verification, a rollback answer) are written down in ARCHITECTURE.md before
the key exists, because they cannot be retrofitted after a first release.
Mobile updates go through the app stores.

## Accepted-open, on record

- **Mobile native manifests are unaudited.** `src-tauri/gen/` is generated
  and git-ignored, and no mobile build has been produced yet. Cleartext
  policy (Android network security config, iOS ATS) gets audited against a
  real build, not assumed from documentation.
- **CI does not yet enforce the gate.** The guards run locally (`pnpm
  check`, pre-push hook). Until CI lands, enforcement holds only for people
  who run them.

## Scaffolding from this template

The security config transfers; the identity in it must not. When rebranding,
re-point rather than delete: the bundle identifier in `tauri.conf.json`, the
API origins in the CSP's `connect-src` and in `ALLOWED_ORIGINS`, and the
capability window names if windows change. A blocked request means the
allowlist needs your value added, never the control removed; every guard
prints what it checks (`pnpm security --print`).
