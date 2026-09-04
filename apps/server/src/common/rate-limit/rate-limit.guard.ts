import { type ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard, type ThrottlerLimitDetail } from "@nestjs/throttler";

import { RateLimitExceededError } from "./errors/rate-limit-errors.js";

/**
 * The framework's throttler, refusing with a domain error instead of its own exception.
 *
 * Everything else in this codebase fails with a code the client can branch on, and a limit
 * is no different: "too fast, wait 30 seconds" is a message a user can act on, a bare 429
 * is not.
 *
 * Registered globally, so a route added later is limited by existing rather than by someone
 * remembering. Socket events are limited by `WsRateLimitInterceptor` instead — this guard
 * reads an HTTP request and response, which a gateway context does not have.
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    return Promise.resolve(context.getType<string>() !== "http");
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const handler = `${context.getClass().name}.${context.getHandler().name}`;

    return Promise.reject(
      new RateLimitExceededError(handler, Math.max(detail.timeToBlockExpire, 1) * 1000),
    );
  }
}
