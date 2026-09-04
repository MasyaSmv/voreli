import { Global, Module } from "@nestjs/common";

import { DOMAIN_EVENT_BUS } from "../../common/events/domain-event-bus.js";
import { RATE_LIMITER } from "../../common/rate-limit/rate-limiter.js";
import { RedisClientFactory } from "./redis-client.factory.js";
import { RedisDomainEventBus } from "./redis-domain-event-bus.js";
import { RedisRateLimiter } from "./redis-rate-limiter.js";
import { RedisThrottlerStorage } from "./redis-throttler.storage.js";

@Global()
@Module({
  providers: [
    RedisClientFactory,
    RedisDomainEventBus,
    { provide: DOMAIN_EVENT_BUS, useExisting: RedisDomainEventBus },
    RedisRateLimiter,
    { provide: RATE_LIMITER, useExisting: RedisRateLimiter },
    RedisThrottlerStorage,
  ],
  exports: [RedisClientFactory, DOMAIN_EVENT_BUS, RATE_LIMITER, RedisThrottlerStorage],
})
export class RedisModule {}
