import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, type RedisClientType } from "redis";

import type { EnvironmentVariables } from "../../config/env.validation.js";

/** The single place that translates application configuration into Redis connections. */
@Injectable()
export class RedisClientFactory {
  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

  create(): RedisClientType {
    return createClient({
      url: this.config.get("REDIS_URL", { infer: true }),

      // Without this, a command issued while Redis is down does not fail — node-redis
      // parks it in an offline queue and holds it until the connection comes back. Every
      // caller here is written to survive Redis being unavailable by falling through to
      // the database, and that fallback is unreachable if the call never returns: the
      // request hangs for the whole outage instead, and nothing is logged. Failing fast
      // is what makes those `catch` blocks mean anything.
      disableOfflineQueue: true,
    });
  }
}
