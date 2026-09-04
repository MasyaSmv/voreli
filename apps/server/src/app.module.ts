import { join } from "node:path";

import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";

import { CommonModule } from "./common/common.module.js";
import { DomainExceptionFilter } from "./common/filters/domain-exception.filter.js";
import { RateLimitModule } from "./common/rate-limit/rate-limit.module.js";
import { validateEnv } from "./config/env.validation.js";
import { DatabaseModule } from "./infra/database/database.module.js";
import { RedisModule } from "./infra/redis/redis.module.js";
import { MediaModule } from "./media/media.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { ChatModule } from "./modules/chat/chat.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { PermissionsModule } from "./modules/permissions/permissions.module.js";
import { RealtimeModule } from "./modules/realtime/realtime.module.js";
import { ServersModule } from "./modules/servers/servers.module.js";
import { VoiceModule } from "./modules/voice/voice.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // One .env for the whole monorepo, so server and client cannot drift apart on the
      // same setting. Each package is started with its own directory as cwd.
      envFilePath: join(process.cwd(), "..", "..", ".env"),
      validate: validateEnv,
    }),
    CommonModule,
    RateLimitModule,
    DatabaseModule,
    RedisModule,
    MediaModule,
    HealthModule,
    AuthModule,
    PermissionsModule,
    RealtimeModule,
    ServersModule,
    ChatModule,
    VoiceModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
})
export class AppModule {}
