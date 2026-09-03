import { HEALTH_ROUTE, type HealthResponse, isHealthResponse } from "@voreli/shared";

export class HealthRequestFailedError extends Error {
  constructor(readonly status: number) {
    super(`Health request failed with status ${String(status)}`);
    this.name = "HealthRequestFailedError";
  }
}

export class UnexpectedHealthPayloadError extends Error {
  constructor() {
    super("Health endpoint answered with a payload that does not match the shared contract");
    this.name = "UnexpectedHealthPayloadError";
  }
}

export async function fetchHealth(baseUrl: string, signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${baseUrl}${HEALTH_ROUTE}`, signal ? { signal } : {});

  if (!response.ok) {
    throw new HealthRequestFailedError(response.status);
  }

  const payload: unknown = await response.json();

  if (!isHealthResponse(payload)) {
    throw new UnexpectedHealthPayloadError();
  }

  return payload;
}
