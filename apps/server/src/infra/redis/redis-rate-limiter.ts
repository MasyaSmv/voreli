import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { RedisClientType } from "redis";

import type { RateLimitDecision, RateLimiter } from "../../common/rate-limit/rate-limiter.js";
import { RedisClientFactory } from "./redis-client.factory.js";

const KEY_PREFIX = "voreli:ratelimit:";

/**
 * Fixed window counter: one INCR per attempt, with the expiry set the first time the key
 * appears. A sliding window would be smoother at the boundary, but it costs a sorted set
 * per key and this limiter guards a single-core box — the cheap answer is the right one.
 *
 * A Redis failure allows the request. That is deliberate: the limiter protects against
 * abuse, and turning an unavailable counter into a wall of 429s would let a Redis blip
 * take the whole product down.
 */
@Injectable()
export class RedisRateLimiter implements RateLimiter, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisRateLimiter.name);
  private readonly redis: RedisClientType;

  constructor(clients: RedisClientFactory) {
    this.redis = clients.create();

    this.redis.on("error", (error: Error) => {
      this.logger.error({ message: "Rate limiter Redis error", error });
    });
  }

  async onModuleInit(): Promise<void> {
    await this.redis.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.isOpen) {
      await this.redis.quit();
    }
  }

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
    const redisKey = KEY_PREFIX + key;

    try {
      const replies = await this.redis.multi().incr(redisKey).pTTL(redisKey).exec();
      const hits = Number(replies[0]);
      const ttlMs = Number(replies[1]);

      // A negative TTL means either the first hit in this window or a key that lost its
      // expiry. Both are repaired the same way; a counter without an expiry would lock the
      // caller out permanently.
      const remainingMs = ttlMs < 0 ? windowMs : ttlMs;

      if (ttlMs < 0) {
        await this.redis.pExpire(redisKey, windowMs);
      }

      return {
        allowed: hits <= limit,
        limit,
        hits,
        resetAfterMs: remainingMs,
      };
    } catch (error: unknown) {
      this.logger.error({
        message: "Rate limit check failed; allowing the attempt",
        error,
        rateLimitKey: key,
        operation: "consumeRateLimit",
      });

      return { allowed: true, limit, hits: 0, resetAfterMs: 0 };
    }
  }
}
