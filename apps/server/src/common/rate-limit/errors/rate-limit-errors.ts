import { HttpStatus } from "@nestjs/common";

import { DomainError } from "../../errors/domain-error.js";
import type { HttpMappable } from "../../errors/http-mappable.js";

/**
 * Carries its own code rather than surfacing as a bare 429: a client that is being limited
 * has to be able to say so, and a silent drop looks to the user like the app is broken.
 */
export class RateLimitExceededError extends DomainError implements HttpMappable {
  static readonly CODE = "RATE_LIMITED";
  readonly errorCode = RateLimitExceededError.CODE;
  readonly httpStatus = HttpStatus.TOO_MANY_REQUESTS;

  constructor(
    readonly action: string,
    readonly retryAfterMs: number,
  ) {
    super(`Too many attempts at ${action}; retry in ${String(Math.ceil(retryAfterMs / 1000))}s`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { action: this.action, retryAfterMs: this.retryAfterMs };
  }
}
