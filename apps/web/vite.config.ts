import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
    port: Number(process.env.WEB_PORT) || 1420,
    strictPort: true,
  },
});
