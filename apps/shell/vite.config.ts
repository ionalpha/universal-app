import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Tauri expects a fixed port and its own env prefixes.
// https://tauri.app
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Prevent Vite from clobbering Rust errors in the terminal.
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1422 } : undefined,
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
