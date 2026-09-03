/**
 * Both facts behind `/health` come in through contracts rather than being read inline:
 * a test can then swap in a real-but-local implementation instead of a mock.
 */
export interface UptimeProvider {
  /** Seconds since the server process started. */
  seconds(): number;
}

export interface AppVersionProvider {
  version(): string;
}

export const UPTIME_PROVIDER = Symbol("UPTIME_PROVIDER");
export const APP_VERSION_PROVIDER = Symbol("APP_VERSION_PROVIDER");
