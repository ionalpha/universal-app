// Layer: app — the one place the frontend spells the product's name.
//
// It exists as a constant rather than a string in JSX so that renaming a clone
// is a single edit with a single check behind it: scripts/identity.mjs lists
// this file as an identity site, so `pnpm template` fails if it ever disagrees
// with the product name in tauri.conf.json. A brand string typed inline in a
// component is exactly the kind of leftover that survives a rename.
export const APP_NAME = "Universal App";
