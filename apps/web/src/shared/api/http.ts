import { serverUrl } from "../config/env";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * The access token lives here, in a module-scoped variable, and never in localStorage:
 * anything readable by script is readable by an XSS, and a stolen access token cannot be
 * revoked before it expires. The refresh token is an httpOnly cookie the page cannot see.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

interface RequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  /** Skips the automatic refresh-and-retry, so refreshing cannot recurse into itself. */
  readonly noRetry?: boolean;
}

async function parse(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null;
  }

  const text = await response.text();

  return text.length === 0 ? null : (JSON.parse(text) as unknown);
}

function errorFrom(status: number, payload: unknown): HttpError {
  const body = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const errorCode = typeof body["errorCode"] === "string" ? body["errorCode"] : "UNKNOWN";
  const message = typeof body["message"] === "string" ? body["message"] : "Request failed";

  return new HttpError(status, errorCode, message);
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // Built conditionally rather than with undefined values: exactOptionalPropertyTypes
  // treats an explicit undefined as a different thing from an absent property.
  const init: RequestInit = {
    method: options.method ?? "GET",
    headers: {
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(accessToken === null ? {} : { Authorization: `Bearer ${accessToken}` }),
    },
    credentials: "include",
  };

  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${serverUrl()}${path}`, init);

  if (response.status === 401 && options.noRetry !== true) {
    // The access token lives 15 minutes; hitting its expiry mid-session is normal, not an
    // error the user should see. Refresh once, then replay the request.
    const refreshed = await refreshAccessToken();

    if (refreshed) {
      return apiFetch<T>(path, { ...options, noRetry: true });
    }
  }

  const payload = await parse(response);

  if (!response.ok) {
    throw errorFrom(response.status, payload);
  }

  return payload as T;
}

export async function refreshAccessToken(): Promise<boolean> {
  try {
    const response = await fetch(`${serverUrl()}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });

    if (!response.ok) {
      setAccessToken(null);

      return false;
    }

    const payload = (await response.json()) as { accessToken: string };
    setAccessToken(payload.accessToken);

    return true;
  } catch {
    setAccessToken(null);

    return false;
  }
}
