// Nest's DI and class-validator read decorator metadata through the reflect-metadata
// polyfill; production loads it in main.ts, tests never reach that entry point.
import "reflect-metadata";

import { resolve } from "node:path";

import { config as loadEnv } from "dotenv";

loadEnv({ path: resolve(process.cwd(), "../../.env"), quiet: true });

// Everything below this line talks to the test database, never to the development one.
const testUrl = process.env["DATABASE_URL_TEST"];

if (typeof testUrl === "string" && testUrl.length > 0) {
  process.env["DATABASE_URL"] = testUrl;
}

process.env["NODE_ENV"] = "test";
// A real mediasoup worker is booted by every application harness. One is enough to test
// the media contracts and keeps the sequential suite from paying for every host CPU.
process.env["MEDIASOUP_MAX_WORKERS"] = "1";
