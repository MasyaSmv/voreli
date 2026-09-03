export class MissingEnvVariableError extends Error {
  constructor(name: string) {
    super(`Environment variable ${name} is required but was not provided at build time`);
    this.name = "MissingEnvVariableError";
  }
}

/**
 * The server address is never hardcoded: an install running fully offline on a home LAN
 * points at its own host, and that is a build-time input, not a constant in the source.
 */
export function serverUrl(): string {
  const value = import.meta.env.VITE_SERVER_URL;

  if (typeof value !== "string") {
    throw new MissingEnvVariableError("VITE_SERVER_URL");
  }

  // An empty value is meaningful, not missing: it means "same origin", which is how the
  // dev server runs so that the httpOnly refresh cookie is sent at all.
  return value.replace(/\/+$/, "");
}
