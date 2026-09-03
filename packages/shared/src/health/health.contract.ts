/**
 * The single liveness contract of the platform.
 *
 * It lives here, and not in the server, because the whole point of the monorepo is that
 * the server producing the response and the client reading it import the exact same type:
 * change a field and the compiler shows both sides that broke.
 */
export const HEALTH_ROUTE = "/health" as const;

export type HealthStatus = "ok";

export interface HealthResponse {
  readonly status: HealthStatus;
  /** Seconds the server process has been running. */
  readonly uptime: number;
  /** Version of the running server build, taken from its package manifest. */
  readonly version: string;
}

/**
 * Narrows an unknown payload — anything crossing the network boundary is unknown — to the
 * contract. The client refuses to render a shape it did not expect rather than guessing.
 */
export function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    candidate["status"] === "ok" &&
    typeof candidate["uptime"] === "number" &&
    Number.isFinite(candidate["uptime"]) &&
    typeof candidate["version"] === "string"
  );
}
