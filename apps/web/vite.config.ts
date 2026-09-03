import { fileURLToPath } from "node:url";

import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

/** The single monorepo-wide .env lives two levels up from this package. */
const envDir = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
  // loadEnv, not process.env: Vite reads .env into import.meta.env for the browser bundle
  // and never into process.env, so a config that reads process.env silently falls back to
  // its default — which is how the dev proxy ended up pointing at the wrong port.
  const env = loadEnv(mode, envDir, "");
  const proxyTarget = env["VITE_DEV_PROXY_TARGET"] ?? "http://localhost:3000";

  return {
    plugins: [react(), tailwind()],
    // Without envDir the client would look for a .env inside apps/web and ship with no
    // server URL at all.
    envDir,
    server: {
      port: 5173,
      strictPort: true,
      // The refresh cookie is httpOnly and SameSite=Lax, so it only travels same-origin.
      // Proxying the API through the dev server keeps development on one origin; the
      // alternative is SameSite=None, which requires HTTPS locally. In production the client
      // is served from its own host and uses VITE_SERVER_URL instead.
      proxy: {
        "/auth": { target: proxyTarget, changeOrigin: true },
        "/health": { target: proxyTarget, changeOrigin: true },
        "/servers": { target: proxyTarget, changeOrigin: true },
        "/channels": { target: proxyTarget, changeOrigin: true },
        "/categories": { target: proxyTarget, changeOrigin: true },
        "/roles": { target: proxyTarget, changeOrigin: true },
        "/members": { target: proxyTarget, changeOrigin: true },
        "/messages": { target: proxyTarget, changeOrigin: true },
        "/invites": { target: proxyTarget, changeOrigin: true },
        // Socket.IO's transport path, not the namespace: the namespace ("/chat") travels
        // inside the handshake, while every connection is made to /socket.io/.
        "/socket.io": { target: proxyTarget, changeOrigin: true, ws: true },
      },
    },
    test: {
      environment: "jsdom",
      globals: false,
      setupFiles: ["./vitest.setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
