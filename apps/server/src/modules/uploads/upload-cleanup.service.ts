import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { NodeEnv, type EnvironmentVariables } from "../../config/env.validation.js";
import { UploadLifecycleService } from "./upload-lifecycle.service.js";
import { UploadCleanupQuery } from "./upload-cleanup.query.js";
import { UploadObjectCleanupService } from "./upload-object-cleanup.service.js";

@Injectable()
export class UploadCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UploadCleanupService.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;
  private stopping = false;

  constructor(
    private readonly lifecycle: UploadLifecycleService,
    private readonly query: UploadCleanupQuery,
    private readonly objects: UploadObjectCleanupService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  onModuleInit(): void {
    if (this.config.get("NODE_ENV", { infer: true }) === NodeEnv.Test) {
      return;
    }

    this.timer = setInterval(() => {
      void this.cleanupExpired().catch((error: unknown) => {
        this.logger.error(
          "Upload expiry cycle failed",
          error instanceof Error ? error.stack : String(error),
        );
      });
    }, 60_000);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (!this.running) return;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.running,
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            this.logger.warn(
              "Upload cleanup drain timed out; pending deletion remains in the database",
            );
            resolve();
          }, 5_000);
        }),
      ]);
    } catch (error: unknown) {
      this.logger.error(
        { error, operation: "upload.cleanup.shutdown" },
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  cleanupExpired(limit = 100): Promise<number> {
    this.running ??= this.cleanupBatch(limit).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async cleanupBatch(limit: number): Promise<number> {
    const due = await this.query.due(limit);
    let cleaned = 0;

    for (const upload of due) {
      if (this.stopping) break;
      try {
        const claimed = await this.lifecycle.claimCleanup(upload.id);
        if (claimed && (await this.objects.clean(claimed))) cleaned += 1;
      } catch (error: unknown) {
        this.logger.error(
          `Failed to clean expired upload ${JSON.stringify({ uploadId: upload.id, objectKey: upload.objectKey })}`,
          error instanceof Error ? error.stack : String(error),
        );
        await this.lifecycle.deferCleanup(upload.id, upload.cleanupAttempts);
      }
    }

    return cleaned;
  }
}
