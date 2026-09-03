import { readFileSync } from "node:fs";

import type { AppVersionProvider } from "./health.contracts.js";

export class MissingPackageVersionError extends Error {
  constructor(manifestPath: string) {
    super(`Package manifest ${manifestPath} has no usable "version" field`);
    this.name = "MissingPackageVersionError";
  }
}

/**
 * Reads the version once at construction: the manifest cannot change while the process
 * runs, and re-reading a file on every health check would be a needless syscall.
 */
export class PackageJsonVersionProvider implements AppVersionProvider {
  private readonly value: string;

  constructor(manifestPath: string) {
    const raw: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));

    const version =
      typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>)["version"]
        : undefined;

    if (typeof version !== "string" || version.length === 0) {
      throw new MissingPackageVersionError(manifestPath);
    }

    this.value = version;
  }

  version(): string {
    return this.value;
  }
}
