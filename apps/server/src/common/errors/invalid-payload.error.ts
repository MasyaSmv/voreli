import { DomainError } from "./domain-error.js";

export class InvalidPayloadError extends DomainError {
  static readonly CODE = "INVALID_PAYLOAD";
  readonly errorCode = InvalidPayloadError.CODE;

  constructor(readonly properties: readonly string[]) {
    super(`Payload is invalid: ${properties.join(", ")}`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { properties: this.properties };
  }
}
