import { SetMetadata } from "@nestjs/common";

export const WS_RATE_LIMIT = Symbol("WS_RATE_LIMIT");

export interface WsRateLimitOptions {
  readonly limit: number;
  readonly windowMs: number;
}

/**
 * Per-handler allowance for a socket event. Absent means the namespace default applies —
 * an event nobody thought about is still limited, which is the point.
 */
export const WsRateLimit = (options: WsRateLimitOptions): MethodDecorator =>
  SetMetadata(WS_RATE_LIMIT, options);
