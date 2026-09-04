import "reflect-metadata";

import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";

import { AppModule } from "./app.module.js";
import { RedisClientFactory } from "./infra/redis/redis-client.factory.js";
import { RedisIoAdapter } from "./infra/socket/redis-io.adapter.js";
import type { EnvironmentVariables } from "./config/env.validation.js";

async function bootstrap(): Promise<void> {
  // Typed as the Express application so `set` below is the framework's own API rather
  // than an untyped escape hatch through the abstract adapter.
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService<EnvironmentVariables, true>);

  app.enableCors({ origin: config.get("CORS_ORIGIN", { infer: true }), credentials: true });

  const trustedHops = config.get("TRUSTED_PROXY_HOPS", { infer: true });

  if (trustedHops > 0) {
    // Express then reads the client address that many hops back in X-Forwarded-For, which
    // is what the rate limiter buckets on.
    app.set("trust proxy", trustedHops);
  }

  const redisAdapter = new RedisIoAdapter(app, app.get(RedisClientFactory));
  await redisAdapter.connect();
  app.useWebSocketAdapter(redisAdapter);

  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();

  const port = config.get("PORT", { infer: true });
  await app.listen(port);

  new Logger("Bootstrap").log(`Voreli server listening on http://localhost:${String(port)}`);
}

void bootstrap();
