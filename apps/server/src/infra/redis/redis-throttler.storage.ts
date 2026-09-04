import { Inject, Injectable } from "@nestjs/common";
import type { ThrottlerStorage } from "@nestjs/throttler";
// Not re-exported from the package root, unlike the interface it belongs to.
import type { ThrottlerStorageRecord } from "@nestjs/throttler/dist/throttler-storage-record.interface.js";

import { RATE_LIMITER, type RateLimiter } from "../../common/rate-limit/rate-limiter.js";

/**
 * Backs `@nestjs/throttler` with the shared Redis counter instead of its default in-memory
 * one. Without this the limit is per process, so three instances mean three times the
 * allowance — the opposite of what a limit is for.
 *
 * `blockDuration` is not implemented separately: exceeding the limit already blocks for the
 * rest of the window, and a second, longer lockout is a policy nobody has asked for.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(@Inject(RATE_LIMITER) private readonly limiter: RateLimiter) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const decision = await this.limiter.consume(`http:${throttlerName}:${key}`, limit, ttl);
    const secondsLeft = Math.ceil(decision.resetAfterMs / 1000);

    return {
      totalHits: decision.hits,
      timeToExpire: secondsLeft,
      isBlocked: !decision.allowed,
      timeToBlockExpire: secondsLeft,
    };
  }
}
