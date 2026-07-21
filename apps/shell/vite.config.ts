import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { devCsp, hardenedHeaders } from "../../scripts/csp.mjs";

// Tauri needs to know the webview URL up front; scripts/desktop.mjs derives
// this clone's shell port and hands it to both Tauri and Vite (via SHELL_PORT)
// so nothing is hardcoded and two apps never fight over a port.
// https://tauri.app
const host = process.env.TAURI_DEV_HOST;
const port = Number(process.env.SHELL_PORT) || 1421;
const hmrPort = Number(process.env.SHELL_HMR_PORT) || port + 1;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Prevent Vite from clobbering Rust errors in the terminal.
  clearScreen: false,
  server: {
    port,
    strictPort: true,
    host: host || false,
    // In desktop dev the webview loads straight from this server, so Tauri
    // never touches the response and `devCsp` in tauri.conf.json would not be
    // applied to anything. Sending the header here is what makes dev enforce a
    // policy at all — without it the strict production CSP is first exercised
    // by a release build, which is the worst possible place to discover it
    // blocks something.
    headers: {
      "Content-Security-Policy": devCsp({
        apiUrl: process.env.VITE_API_URL,
        shellPort: port,
        hmrPort,
        host: host || undefined,
      }),
      // The same non-CSP headers production sets via app.security.headers, so
      // the one value that can break a working request (COEP require-corp
      // blocks any fetch the API does not CORS-approve) breaks in dev first.
      ...hardenedHeaders(),
    },
    hmr: host ? { protocol: "ws", host, port: hmrPort } : undefined,
    // The LAN bind (TAURI_DEV_HOST, required for on-device mobile dev) is the
    // precondition for the recurring Vite dev-server file-read CVEs
    // (CVE-2026-39364, CVE-2026-39363, CVE-2025-30208 were all this shape), so
    // the server is configured as if the network were hostile:
    // - allowedHosts: only the LAN host itself, never `true`. A malicious page
    //   can point a hostname it controls at this machine (DNS rebinding) and
    //   talk to the dev server as same-origin; the Host check breaks that.
    // - cors false: no cross-origin page can read responses. The webview loads
    //   same-origin, and the mobile proxy fetches server-side, so nothing
    //   legitimate needs CORS here.
    // - fs.deny on top of strict: the serving allow-list is the monorepo root
    //   (wider than a single-package project), so the files an attacker would
    //   actually want are denied by name as a second layer.
    allowedHosts: host ? [host] : [],
    cors: false,
    fs: {
      strict: true,
      deny: ["**/.env*", "**/*.pem", "**/.dev-ports.json", "**/src-tauri/**"],
    },
    watch: {
      // Rust recompiles on its own; don't let Vite watch it.
      ignored: ["**/src-tauri/**"],
    },
  },
  // Env vars starting with these are exposed to the client.
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // Tauri uses Chromium on Windows/Linux and WebKit on macOS/iOS.
    // safari15 = iOS 15+ baseline; esbuild can't downlevel modern JS to safari13.
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari15",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
});
