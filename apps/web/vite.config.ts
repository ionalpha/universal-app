import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { webCsp, webHeadersFile } from "../../scripts/csp.mjs";

const port = Number(process.env.WEB_PORT) || 1420;
const apiUrl = process.env.VITE_API_URL;

// https://vite.dev
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // A static SPA has no server to set response headers, so the production
    // policy ships as a file the host reads. `_headers` is the Netlify and
    // Cloudflare Pages format; other hosts need it translated, which is why
    // README documents the equivalents rather than pretending this covers
    // everything. Emitting it here means the built output carries its own
    // security posture instead of depending on someone remembering.
    {
      name: "emit-security-headers",
      generateBundle() {
        if (!apiUrl) {
          // The policy allows exactly the origin the bundle will call. Building
          // without VITE_API_URL bakes in the localhost fallback, so a deploy
          // pointed at a real API would have every request blocked by its own
          // CSP — with nothing in the build output to explain why.
          this.warn(
            "VITE_API_URL is unset, so the emitted _headers allows only the default API " +
              "origin. Set VITE_API_URL at build time when deploying.",
          );
        }
        this.emitFile({ type: "asset", fileName: "_headers", source: webHeadersFile(apiUrl) });
      },
    },
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Universal App",
        short_name: "Universal",
        description: "One app across web, desktop and mobile.",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        icons: [
          {
            src: "pwa-icon.png",
            sizes: "256x256",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
    }),
  ],
  server: {
    // Derived per-clone by scripts/ports.mjs and passed in via WEB_PORT, so
    // multiple templated apps can run at once. The fallback is only for a bare
    // `vite` invocation outside the pnpm scripts.
    port,
    strictPort: true,
    // Same policy as production, relaxed only where Vite's dev machinery forces
    // it. Without this the strict policy is first exercised by a deploy.
    headers: {
      "Content-Security-Policy": webCsp({ apiUrl, dev: true, port }),
    },
  },
});
