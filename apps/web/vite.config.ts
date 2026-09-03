import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwind()],
  // The single monorepo-wide .env lives two levels up; without this Vite would look for
  // one inside apps/web and silently ship a client with no server URL.
  envDir: "../..",
  server: {
    port: 5173,
    strictPort: true,
    // The refresh cookie is httpOnly and SameSite=Lax, which means it only travels
    // same-origin. Proxying the API through the dev server keeps development on one origin;
    // the alternative is SameSite=None, which requires HTTPS locally. In production the
    // client is served from its own host and uses VITE_SERVER_URL instead.
    proxy: {
      "/auth": { target: process.env["VITE_DEV_PROXY_TARGET"] ?? "http://localhost:3000", changeOrigin: true },
      "/health": { target: process.env["VITE_DEV_PROXY_TARGET"] ?? "http://localhost:3000", changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
