import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { config as loadEnv } from "dotenv";

/**
 * Applies migrations to the test database once per run, not once per test file.
 *
 * Recreating the schema per test costs seconds each and minutes per run; a migrated schema
 * plus a transaction rolled back after every test gives the same isolation for free.
 */
export default function setup(): void {
  loadEnv({ path: resolve(process.cwd(), "../../.env"), quiet: true });

  const testUrl = process.env["DATABASE_URL_TEST"];

  if (typeof testUrl !== "string" || testUrl.length === 0) {
    throw new Error(
      "DATABASE_URL_TEST is not set. Tests run against a real Postgres, and never against " +
        "the development database — see docs/specs/002-data-model-and-auth.md.",
    );
  }

  execFileSync("./node_modules/.bin/prisma", ["migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: "inherit",
  });
}
