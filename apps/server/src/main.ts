import "reflect-metadata";

import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";

import { AppModule } from "./app.module.js";
import { RedisIoAdapter } from "./infra/socket/redis-io.adapter.js";
import type { EnvironmentVariables } from "./config/env.validation.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<EnvironmentVariables, true>);

  app.enableCors({ origin: config.get("CORS_ORIGIN", { infer: true }), credentials: true });
  const redisAdapter = new RedisIoAdapter(app, config.get("REDIS_URL", { infer: true }));
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
