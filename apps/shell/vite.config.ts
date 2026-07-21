import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { devCsp } from "../../scripts/csp.mjs";

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
    },
    hmr: host ? { protocol: "ws", host, port: hmrPort } : undefined,
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
