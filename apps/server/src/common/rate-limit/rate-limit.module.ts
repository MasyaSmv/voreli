import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";

import { RedisThrottlerStorage } from "../../infra/redis/redis-throttler.storage.js";
import { RateLimitGuard } from "./rate-limit.guard.js";
import { WsRateLimitInterceptor } from "./ws-rate-limit.interceptor.js";

/**
 * Allowances routes override the default with, via `@Throttle({ default: RATE_LIMITS.x })`.
 *
 * One throttler is configured rather than several named ones because every configured
 * throttler applies to every route it guards: a second entry named `login` would put the
 * login allowance on the whole HTTP surface. The default below is the baseline every route
 * gets; the entries here are what specific routes ask for instead.
 *
 * `login` and `register` are the strict ones because `LoginService` hashes with argon2 even
 * for a user that does not exist — correct against username probing, and without a limit
 * also a way to eat the single core this runs on.
 */
export const RATE_LIMITS = {
  login: { limit: 10, ttl: 15 * 60_000 },
  register: { limit: 5, ttl: 15 * 60_000 },
  invite: { limit: 10, ttl: 60_000 },
} as const;

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        storage,
        throttlers: [{ name: "default", limit: 120, ttl: 60_000 }],
      }),
    }),
  ],
  providers: [
    RateLimitGuard,
    { provide: APP_GUARD, useExisting: RateLimitGuard },
    WsRateLimitInterceptor,
  ],
  exports: [RateLimitGuard, WsRateLimitInterceptor],
})
export class RateLimitModule {}
