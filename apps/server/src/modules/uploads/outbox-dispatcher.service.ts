import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import {
  BACKGROUND_JOB_PUBLISHER,
  type BackgroundJobPublisher,
} from "../../infra/queue/background-job-publisher.js";
import { NodeEnv, type EnvironmentVariables } from "../../config/env.validation.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import { UPLOAD_OUTBOX_EVENT } from "./upload-lifecycle.service.js";

export const UPLOAD_QUEUE = "uploads";
export const PROCESS_UPLOAD_JOB = "attachment-process";

interface OutboxRow {
  readonly id: string;
  readonly aggregateId: string;
  readonly attempts: number;
}

class PublishFailed extends Error {
  constructor(
    readonly event: OutboxRow,
    readonly causeValue: unknown,
  ) {
    super(`Publishing outbox event ${event.id} failed`);
  }
}

@Injectable()
export class OutboxDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcherService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BACKGROUND_JOB_PUBLISHER) private readonly jobs: BackgroundJobPublisher,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  onModuleInit(): void {
    if (this.config.get("NODE_ENV", { infer: true }) === NodeEnv.Test) {
      return;
    }

    this.timer = setInterval(() => {
      void this.dispatchBatch().catch((error: unknown) => {
        this.logger.error(
          "Outbox dispatch cycle failed",
          error instanceof Error ? error.stack : String(error),
        );
      });
    }, 1_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async dispatchBatch(limit = 20): Promise<number> {
    let published = 0;

    while (published < limit) {
      try {
        const found = await this.dispatchOne();

        if (!found) {
          break;
        }

        published += 1;
      } catch (error: unknown) {
        if (error instanceof PublishFailed) {
          await this.recordFailure(error.event);
          this.logger.error(
            `Outbox publish failed ${JSON.stringify({ eventId: error.event.id, aggregateId: error.event.aggregateId })}`,
            error.causeValue instanceof Error ? error.causeValue.stack : String(error.causeValue),
          );
          break;
        }

        throw error;
      }
    }

    return published;
  }

  private dispatchOne(): Promise<boolean> {
    return this.prisma.runInTransaction(async () => {
      const events = await this.prisma.db.$queryRaw<OutboxRow[]>`
        SELECT "id", "aggregateId", "attempts"
        FROM "outbox_events"
        WHERE "publishedAt" IS NULL
          AND "nextAttempt" <= clock_timestamp()
          AND "type" = ${UPLOAD_OUTBOX_EVENT}
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      const event = events[0];

      if (!event) {
        return false;
      }

      try {
        await this.jobs.publish(
          UPLOAD_QUEUE,
          PROCESS_UPLOAD_JOB,
          { uploadId: event.aggregateId },
          event.aggregateId,
        );
      } catch (error: unknown) {
        throw new PublishFailed(event, error);
      }

      await this.prisma.db.outboxEvent.update({
        where: { id: event.id },
        data: { publishedAt: new Date(), attempts: { increment: 1 } },
      });

      return true;
    });
  }

  private async recordFailure(event: OutboxRow): Promise<void> {
    const delaySeconds = Math.min(300, 2 ** Math.min(event.attempts, 8));
    await this.prisma.db.outboxEvent.updateMany({
      where: { id: event.id, publishedAt: null },
      data: {
        attempts: { increment: 1 },
        nextAttempt: new Date(Date.now() + delaySeconds * 1_000),
      },
    });
  }
}
