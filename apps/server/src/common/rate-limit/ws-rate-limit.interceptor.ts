import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Ack } from "@voreli/shared";
import { type Observable, of } from "rxjs";

import { RateLimitExceededError } from "./errors/rate-limit-errors.js";
import { RATE_LIMITER, type RateLimiter } from "./rate-limiter.js";
import { WS_RATE_LIMIT, type WsRateLimitOptions } from "./ws-rate-limit.decorator.js";

/** Applies to any socket event that does not declare its own allowance. */
const DEFAULT_LIMIT: WsRateLimitOptions = { limit: 60, windowMs: 10_000 };

/**
 * One limiter in front of every socket handler, instead of a check written into each of
 * them: a handler added later is limited by existing, not by remembering.
 *
 * The counter is keyed by user and event, not by socket. A per-socket counter would be the
 * weaker of the two — a socket's traffic already counts against its user — and opening a
 * second connection would double the allowance it was supposed to enforce.
 *
 * A refusal is returned as an ack rather than thrown, so the client sees the same shape as
 * every other refusal and can tell the person why nothing happened.
 */
@Injectable()
export class WsRateLimitInterceptor implements NestInterceptor {
  private readonly logger = new Logger(WsRateLimitInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const socket = context.switchToWs().getClient<{ data?: { userId?: string } }>();
    const userId = socket.data?.userId;

    if (userId === undefined) {
      // Unauthenticated sockets never reach a handler; if one does, that is the connection
      // middleware's problem and not something to silently rate limit around.
      return next.handle();
    }

    const action = context.getHandler().name;
    const options =
      this.reflector.get<WsRateLimitOptions | undefined>(WS_RATE_LIMIT, context.getHandler()) ??
      DEFAULT_LIMIT;

    const decision = await this.limiter.consume(
      `ws:${action}:${userId}`,
      options.limit,
      options.windowMs,
    );

    if (decision.allowed) {
      return next.handle();
    }

    const error = new RateLimitExceededError(action, decision.resetAfterMs);

    this.logger.warn({
      message: "Socket event refused by the rate limiter",
      errorCode: error.errorCode,
      userId,
      action,
      ...error.context(),
    });

    const refusal: Ack<never> = {
      ok: false,
      errorCode: error.errorCode,
      message: error.message,
    };

    return of(refusal);
  }
}
