import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";

import { CLOCK, type Clock } from "../../src/common/services/clock.js";
import { StorageModule } from "../../src/infra/storage/storage.module.js";
import { UploadCleanupQuery } from "../../src/modules/uploads/upload-cleanup.query.js";
import { UploadCleanupService } from "../../src/modules/uploads/upload-cleanup.service.js";
import { UploadLifecycleService } from "../../src/modules/uploads/upload-lifecycle.service.js";
import { UploadObjectCleanupService } from "../../src/modules/uploads/upload-object-cleanup.service.js";
import { TcpFaultProxy } from "../support/tcp-fault-proxy.js";
import type { TestApp } from "../support/test-app.js";

export async function faultyStorageCleanup(harness: TestApp) {
  const config = harness.app.get(ConfigService);
  const proxy = new TcpFaultProxy(new URL(config.getOrThrow<string>("S3_ENDPOINT")));
  const endpoint = await proxy.listen();
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        ignoreEnvVars: true,
        load: [
          () => ({
            NODE_ENV: "test",
            S3_ENDPOINT: endpoint,
            ...Object.fromEntries(
              [
                "S3_REGION",
                "S3_ACCESS_KEY",
                "S3_SECRET_KEY",
                "S3_BUCKET",
                "S3_FORCE_PATH_STYLE",
              ].map((key) => [key, config.getOrThrow<unknown>(key)]),
            ),
          }),
        ],
      }),
      StorageModule,
    ],
    providers: [
      { provide: CLOCK, useValue: harness.app.get<Clock>(CLOCK) },
      {
        provide: UploadCleanupQuery,
        useValue: harness.app.get<UploadCleanupQuery>(UploadCleanupQuery),
      },
      {
        provide: UploadLifecycleService,
        useValue: harness.app.get<UploadLifecycleService>(UploadLifecycleService),
      },
      UploadObjectCleanupService,
      UploadCleanupService,
    ],
  }).compile();
  await moduleRef.init();
  return {
    cleanup: moduleRef.get(UploadCleanupService),
    proxy,
    async close(): Promise<void> {
      await moduleRef.close();
      await proxy.close();
    },
  };
}
