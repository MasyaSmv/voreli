import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { Queue } from "bullmq";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaService } from "../../src/infra/database/prisma.service.js";
import { BullMqJobPublisher } from "../../src/infra/queue/bullmq-job-publisher.js";
import { QueueModule } from "../../src/infra/queue/queue.module.js";
import {
  OutboxDispatcherService,
  UPLOAD_QUEUE,
} from "../../src/modules/uploads/outbox-dispatcher.service.js";
import { UploadLifecycleService } from "../../src/modules/uploads/upload-lifecycle.service.js";
import { Factories } from "../support/factories.js";
import { TcpFaultProxy } from "../support/tcp-fault-proxy.js";
import { createTestApp, type TestApp } from "../support/test-app.js";

describe("upload outbox recovery against real Redis", () => {
  let harness: TestApp;
  let proxy: TcpFaultProxy;
  let publisherModule: TestingModule;
  let dispatcher: OutboxDispatcherService;
  let queue: Queue;
  let uploadId: string;

  beforeAll(async () => {
    harness = await createTestApp();
    const redisUrl = harness.app.get(ConfigService).getOrThrow<string>("REDIS_URL");
    proxy = new TcpFaultProxy(new URL(redisUrl));
    const proxyUrl = await proxy.listen();
    const prefix = harness.app.get(ConfigService).getOrThrow<string>("QUEUE_PREFIX");
    publisherModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          load: [() => ({ REDIS_URL: proxyUrl, NODE_ENV: "test", QUEUE_PREFIX: prefix })],
        }),
        QueueModule,
      ],
      providers: [{ provide: PrismaService, useValue: harness.prisma }, OutboxDispatcherService],
    }).compile();
    await publisherModule.init();
    dispatcher = publisherModule.get(OutboxDispatcherService);
    queue = new Queue(UPLOAD_QUEUE, { connection: { url: redisUrl }, prefix });
  });

  afterAll(async () => {
    await publisherModule.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await proxy.close();
    await harness.close();
  });

  beforeEach(async () => {
    await publisherModule.get(BullMqJobPublisher).onModuleDestroy();
    proxy.fault("forward");
    await harness.beginTransaction();
    const server = await new Factories(harness.prisma).server();
    const lifecycle = harness.app.get(UploadLifecycleService);
    const upload = await lifecycle.reserve({
      ownerId: server.ownerId,
      purpose: "ATTACHMENT",
      originalName: "test.txt",
      declaredMime: "text/plain",
      byteSize: 4,
    });
    uploadId = upload.id;
    await lifecycle.complete(uploadId, server.ownerId, "0".repeat(64));
  });

  afterEach(async () => {
    await queue.remove(uploadId);
    await harness.rollbackTransaction();
  });

  it.each(["disconnect", "stall"] as const)(
    "keeps an event pending on a cold %s, then publishes it after recovery",
    async (fault) => {
      proxy.fault(fault);
      const started = Date.now();
      expect(await dispatcher.dispatchBatch()).toBe(0);
      expect(Date.now() - started).toBeLessThan(4_000);
      const event = await harness.prisma.db.outboxEvent.findFirstOrThrow({
        where: { aggregateId: uploadId },
      });
      expect(event.publishedAt).toBeNull();
      expect(event.attempts).toBe(1);
      expect(await queue.getJob(uploadId)).toBeUndefined();

      proxy.fault("forward");
      await harness.prisma.db.outboxEvent.update({
        where: { id: event.id },
        data: { nextAttempt: new Date(0) },
      });
      expect(await dispatcher.dispatchBatch()).toBe(1);
      expect((await queue.getJob(uploadId))?.data).toEqual({ uploadId });
    },
  );

  it("recovers from a connected Redis that stops replying without duplicating an accepted job", async () => {
    expect(await dispatcher.dispatchBatch()).toBe(1);
    await harness.prisma.db.outboxEvent.updateMany({
      where: { aggregateId: uploadId },
      data: { publishedAt: null },
    });
    proxy.stallTraffic();
    const started = Date.now();
    expect(await dispatcher.dispatchBatch()).toBe(0);
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(
      await harness.prisma.db.outboxEvent.findFirstOrThrow({
        where: { aggregateId: uploadId },
      }),
    ).toMatchObject({ publishedAt: null, attempts: 2 });

    proxy.fault("forward");
    await harness.prisma.db.outboxEvent.updateMany({
      where: { aggregateId: uploadId },
      data: { nextAttempt: new Date(0) },
    });
    expect(await dispatcher.dispatchBatch()).toBe(1);
    expect((await queue.getJob(uploadId))?.data).toEqual({ uploadId });
  });

  it("deduplicates a replay after queue add succeeds but its DB acknowledgement is lost", async () => {
    expect(await dispatcher.dispatchBatch()).toBe(1);
    const firstJob = await queue.getJob(uploadId);
    await harness.prisma.db.outboxEvent.updateMany({
      where: { aggregateId: uploadId },
      data: { publishedAt: null },
    });
    expect(await dispatcher.dispatchBatch()).toBe(1);
    const replayedJob = await queue.getJob(uploadId);
    expect(replayedJob?.id).toBe(firstJob?.id);
    expect(replayedJob?.timestamp).toBe(firstJob?.timestamp);
    expect(await dispatcher.dispatchBatch()).toBe(0);
  });
});
