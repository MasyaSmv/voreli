import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import type { EnvironmentVariables } from "../../config/env.validation.js";
import type { BackgroundJobPublisher } from "./background-job-publisher.js";

interface QueueResource {
  readonly queue: Queue;
  readonly connection: Redis;
}

@Injectable()
export class BullMqJobPublisher implements BackgroundJobPublisher, OnModuleDestroy {
  private readonly logger = new Logger(BullMqJobPublisher.name);
  private readonly queues = new Map<string, Promise<QueueResource>>();
  private readonly redisUrl: string;
  private readonly prefix: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.redisUrl = config.get("REDIS_URL", { infer: true });
    this.prefix = config.get("QUEUE_PREFIX", { infer: true }) ?? "voreli";
  }

  async publish(
    queueName: string,
    jobName: string,
    payload: Readonly<Record<string, string>>,
    jobId: string,
  ): Promise<void> {
    const pending = this.queue(queueName);
    let resource: QueueResource | undefined;
    try {
      resource = await pending;
      await resource.queue.add(jobName, payload, {
        jobId,
        attempts: 5,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: { age: 3_600, count: 1_000 },
        removeOnFail: { age: 86_400, count: 1_000 },
      });
    } catch (error: unknown) {
      if (this.queues.get(queueName) === pending) {
        this.queues.delete(queueName);
      }
      if (resource) {
        await this.close(resource);
      }
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [...this.queues.values()].map(async (pending) => {
        try {
          await this.close(await pending);
        } catch (error: unknown) {
          this.logger.error(
            { error, operation: "queue.shutdown" },
            error instanceof Error ? error.stack : undefined,
          );
        }
      }),
    );
    this.queues.clear();
  }

  private queue(name: string): Promise<QueueResource> {
    let pending = this.queues.get(name);
    if (!pending) {
      pending = this.connect(name);
      this.queues.set(name, pending);
    }
    return pending;
  }

  private async connect(name: string): Promise<QueueResource> {
    // The database outbox owns retries. A producer must release its transaction even
    // when Redis accepts TCP but never replies, or is absent on the first publish.
    const connection = new Redis(this.redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
      commandTimeout: 1_000,
      retryStrategy: null,
    });
    connection.on("error", (error: Error) => {
      this.logger.error({ error, operation: "queue.connection", queueName: name }, error.stack);
    });

    try {
      await connection.connect();
      const queue = new Queue(name, { connection, prefix: this.prefix });
      queue.on("error", (error: Error) => {
        this.logger.error({ error, operation: "queue.publish", queueName: name }, error.stack);
      });
      return { queue, connection };
    } catch (error: unknown) {
      connection.disconnect();
      throw error;
    }
  }

  private async close(resource: QueueResource): Promise<void> {
    resource.connection.disconnect();
    await resource.queue.close();
  }
}
