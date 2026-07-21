//! Regenerates `apps/shell/src/bindings.ts` from the Rust command surface.
//!
//! A binary rather than a `#[test]`: on Windows this crate builds a `cdylib`
//! named `app_lib.dll` into the same `deps/` directory the unit-test harness
//! runs from, and the loader resolves the test executable's imports against it
//! and fails with STATUS_ENTRYPOINT_NOT_FOUND. A bin lands in `target/debug/`
//! instead, so generation does not depend on the test harness working.
//!
//! Run it with `pnpm bindings`; `pnpm bindings:check` runs it and then fails if
//! the generated file changed, which is the drift gate.

use specta_typescript::Typescript;

/// Anchored to the crate directory rather than the process working directory,
/// so `cargo run --manifest-path ...` from the repo root writes to the same
/// place as `cargo run` from inside the crate. A relative path here silently
/// wrote the file outside the repo when invoked from the root.
const BINDINGS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/bindings.ts");

fn main() {
    app_lib::ipc()
        .export(Typescript::default(), BINDINGS)
        .expect("failed to export TypeScript bindings");

    println!("wrote apps/shell/src/bindings.ts");
}
