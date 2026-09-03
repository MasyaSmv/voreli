import { join } from "node:path";

import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";

import { CommonModule } from "./common/common.module.js";
import { DomainExceptionFilter } from "./common/filters/domain-exception.filter.js";
import { validateEnv } from "./config/env.validation.js";
import { DatabaseModule } from "./infra/database/database.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { HealthModule } from "./modules/health/health.module.js";

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
    DatabaseModule,
    HealthModule,
    AuthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
})
export class AppModule {}
