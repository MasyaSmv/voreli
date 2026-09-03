/**
 * Marker for domain errors that map to a specific HTTP status.
 *
 * The status lives on the error class rather than in a table inside the exception filter:
 * a new failure mode is then a new file, and the filter never changes. Errors that do not
 * implement this get the default the filter chooses.
 */
export interface HttpMappable {
  readonly httpStatus: number;
}

export function isHttpMappable(value: unknown): value is HttpMappable {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { httpStatus?: unknown }).httpStatus === "number"
  );
}
