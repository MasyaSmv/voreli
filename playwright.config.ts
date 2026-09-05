import { defineConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env", quiet: true });

const databaseUrl = process.env["DATABASE_URL_TEST"];
if (!databaseUrl) throw new Error("DATABASE_URL_TEST is required for Playwright");
process.env["DATABASE_URL"] = databaseUrl;

const serverEnvironment = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  PORT: "3200",
  CORS_ORIGIN: "http://127.0.0.1:5174",
  INSTANCE_ID: "voreli-playwright",
  TRUSTED_PROXY_HOPS: "1",
  MEDIASOUP_ANNOUNCED_IP: "127.0.0.1",
  MEDIASOUP_LISTEN_IP: "0.0.0.0",
  MEDIASOUP_RTC_MIN_PORT: "41000",
  MEDIASOUP_RTC_MAX_PORT: "41010",
  MEDIASOUP_MAX_WORKERS: "1",
};

export default defineConfig({
  testDir: "./apps/server/e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 45_000,
  use: {
    baseURL: "http://127.0.0.1:5174",
    permissions: ["microphone"],
    launchOptions: {
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    },
  },
  webServer: [
    {
      command:
        "pnpm --filter @voreli/server exec prisma migrate deploy && " +
        "pnpm --filter @voreli/server build && pnpm --filter @voreli/server start",
      url: "http://127.0.0.1:3200/health",
      env: serverEnvironment,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @voreli/web dev --host 127.0.0.1 --port 5174",
      url: "http://127.0.0.1:5174",
      env: {
        ...process.env,
        VITE_DEV_PROXY_TARGET: "http://127.0.0.1:3200",
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
