import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Worker } from "bullmq";

import { NodeEnv, type EnvironmentVariables } from "../../config/env.validation.js";
import { PROCESS_UPLOAD_JOB, UPLOAD_QUEUE } from "./outbox-dispatcher.service.js";
import { UploadProcessorService } from "./upload-processor.service.js";

interface UploadJobData {
  readonly uploadId: string;
}

@Injectable()
export class UploadWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UploadWorkerService.name);
  private readonly redisUrl: string;
  private worker: Worker<UploadJobData> | null = null;

  constructor(
    private readonly processor: UploadProcessorService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.redisUrl = config.get("REDIS_URL", { infer: true });
  }

  async onModuleInit(): Promise<void> {
    if (this.config.get("NODE_ENV", { infer: true }) === NodeEnv.Test) {
      return;
    }

    await this.start();
  }

  async start(): Promise<void> {
    if (this.worker) {
      await this.worker.waitUntilReady();
      return;
    }

    this.worker = new Worker<UploadJobData>(
      UPLOAD_QUEUE,
      async (job) => {
        if (job.name !== PROCESS_UPLOAD_JOB || typeof job.data.uploadId !== "string") {
          throw new Error(`Unsupported upload job ${job.name}`);
        }

        await this.processor.process(job.data.uploadId);
      },
      {
        connection: {
          url: this.redisUrl,
          maxRetriesPerRequest: null,
        },
        prefix: this.config.get("QUEUE_PREFIX", { infer: true }) ?? "voreli",
        concurrency: 2,
      },
    );

    this.worker.on("error", (error: Error) => {
      this.logger.error({ error, operation: "upload.worker" }, error.stack);
    });

    this.worker.on("failed", (job, error) => {
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        this.logger.error(
          `Upload job exhausted retries ${JSON.stringify({ jobId: job.id, uploadId: job.data.uploadId })}`,
          error.stack,
        );
      }
    });
    await this.worker.waitUntilReady();
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.worker) {
      return;
    }

    const worker = this.worker;
    this.worker = null;
    let timer: NodeJS.Timeout | undefined;
    try {
      // BullMQ memoizes close(): a later close(true) cannot force an earlier close().
      // Pause intake and drain first, then close the connections exactly once.
      const drained = await Promise.race([
        worker.pause().then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), 5_000);
        }),
      ]);
      if (!drained) {
        this.logger.warn("Upload worker drain timed out; unfinished jobs remain recoverable");
      }
    } finally {
      if (timer) clearTimeout(timer);
      await worker.close(true);
    }
  }
}
