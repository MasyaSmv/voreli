import { join } from "node:path";

import { Module } from "@nestjs/common";

import { APP_VERSION_PROVIDER, UPTIME_PROVIDER } from "./health.contracts.js";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";
import { PackageJsonVersionProvider } from "./package-json-version.provider.js";
import { ProcessUptimeProvider } from "./process-uptime.provider.js";

@Module({
  controllers: [HealthController],
  providers: [
    HealthService,
    { provide: UPTIME_PROVIDER, useClass: ProcessUptimeProvider },
    {
      provide: APP_VERSION_PROVIDER,
      // The package is always started with its own directory as cwd (pnpm --filter does
      // this), so the manifest sits next to it whether we run from dist or from Vitest.
      useFactory: () => new PackageJsonVersionProvider(join(process.cwd(), "package.json")),
    },
  ],
})
export class HealthModule {}
