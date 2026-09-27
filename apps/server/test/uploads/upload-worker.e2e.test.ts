import { createHash, randomUUID } from "node:crypto";

import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { Queue } from "bullmq";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../src/common/events/domain-event-bus.js";
import { PrismaService } from "../../src/infra/database/prisma.service.js";
import { QueueModule } from "../../src/infra/queue/queue.module.js";
import { BullMqJobPublisher } from "../../src/infra/queue/bullmq-job-publisher.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../../src/infra/storage/object-storage.js";
import {
  OutboxDispatcherService,
  UPLOAD_QUEUE,
} from "../../src/modules/uploads/outbox-dispatcher.service.js";
import { uploadObjectKeys } from "../../src/modules/uploads/upload-object-keys.js";
import { UploadProcessorService } from "../../src/modules/uploads/upload-processor.service.js";
import { UploadWorkerService } from "../../src/modules/uploads/upload-worker.service.js";
import { UploadService } from "../../src/modules/uploads/upload.service.js";
import { Factories, type SeededServer } from "../support/factories.js";
import { createTestApp, type TestApp } from "../support/test-app.js";
import { TcpFaultProxy } from "../support/tcp-fault-proxy.js";

// Worker callbacks need committed rows. A rollback transaction in the test would hide them.
describe("committed uploads consumed by the real BullMQ worker", () => {
  let harness: TestApp;
  let runtime: TestingModule;
  let redisProxy: TcpFaultProxy;
  let queue: Queue;
  let storage: ObjectStorage;
  let server: SeededServer;
  let uploadId: string;
  let bytes: Buffer;
  let stagingKey: string;
  let unsubscribe: () => void;
  const keys = new Set<string>();
  const notifications: { uploadId: string; ownerId: string; status: string | undefined }[] = [];

  beforeAll(async () => {
    harness = await createTestApp();
    storage = harness.app.get<ObjectStorage>(OBJECT_STORAGE);
    const redisUrl = harness.app.get(ConfigService).getOrThrow<string>("REDIS_URL");
    redisProxy = new TcpFaultProxy(new URL(redisUrl));
    const proxyUrl = await redisProxy.listen();
    const prefix = `voreli-test-${randomUUID()}`;
    runtime = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          load: [() => ({ REDIS_URL: proxyUrl, QUEUE_PREFIX: prefix, NODE_ENV: "test" })],
        }),
        QueueModule,
      ],
      providers: [
        { provide: PrismaService, useValue: harness.prisma },
        {
          provide: UploadProcessorService,
          useValue: harness.app.get<UploadProcessorService>(UploadProcessorService),
        },
        OutboxDispatcherService,
        UploadWorkerService,
      ],
    }).compile();
    await runtime.init();
    queue = new Queue(UPLOAD_QUEUE, { connection: { url: redisUrl }, prefix });
    unsubscribe = harness.app
      .get<DomainEventBus>(DOMAIN_EVENT_BUS)
      .subscribe("upload.ready", async (event) => {
        const row = await harness.prisma.client.upload.findUnique({
          where: { id: event.uploadId },
        });
        notifications.push({ ...event, status: row?.status });
      });
  });
  afterAll(async () => {
    unsubscribe();
    await runtime.close();
    await redisProxy.close();
    // Only this test's UUID-prefixed queue is removed, never the application's queue.
    await queue.obliterate({ force: true });
    await queue.close();
    await harness.close();
  });
  beforeEach(async () => {
    await runtime.get(BullMqJobPublisher).onModuleDestroy();
    redisProxy.fault("forward");
    notifications.length = 0;
    server = await new Factories(harness.prisma).server();
    bytes = await sharp({ create: { width: 40, height: 30, channels: 3, background: "blue" } })
      .png()
      .toBuffer();
    const uploads = harness.app.get(UploadService);
    const reserved = await uploads.reserve(server.ownerId, {
      fileName: "worker.png",
      byteSize: bytes.length,
      declaredMime: "image/png",
      purpose: "attachment",
    });
    uploadId = reserved.uploadId;
    const row = await harness.prisma.db.upload.findUniqueOrThrow({ where: { id: uploadId } });
    stagingKey = row.objectKey;
    for (const key of Object.values(uploadObjectKeys(row))) keys.add(key);
    await storage.write(stagingKey, bytes, "image/png");
    await uploads.complete(server.ownerId, uploadId, {
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    });
  });
  afterEach(async () => {
    await runtime.get(UploadWorkerService).onModuleDestroy();
    await queue.remove(uploadId);
    for (const key of keys) await storage.delete(key);
    keys.clear();
    await harness.prisma.db.outboxEvent.deleteMany({ where: { aggregateId: uploadId } });
    await harness.prisma.db.server.delete({ where: { id: server.serverId } });
    await harness.prisma.db.user.delete({ where: { id: server.ownerId } });
  });

  async function dispatchAndStart(): Promise<void> {
    expect(await runtime.get(OutboxDispatcherService).dispatchBatch()).toBe(1);
    await runtime.get(UploadWorkerService).start();
  }
  async function completed(): Promise<void> {
    await expect
      .poll(async () => (await queue.getJob(uploadId))?.getState(), { timeout: 10_000 })
      .toBe("completed");
  }

  it("processes committed work after the request is gone and announces persisted READY", async () => {
    expect(
      (await harness.prisma.client.upload.findUniqueOrThrow({ where: { id: uploadId } })).status,
    ).toBe("UPLOADED");
    await dispatchAndStart();
    await completed();
    await expect
      .poll(() => notifications)
      .toEqual([{ uploadId, ownerId: server.ownerId, status: "READY" }]);
    const row = await harness.prisma.db.upload.findUniqueOrThrow({ where: { id: uploadId } });
    expect(await storage.head(row.thumbnailKey ?? "")).toMatchObject({ contentType: "image/webp" });
    expect(await storage.head(stagingKey)).toBeNull();

    // Even after BullMQ's deduplication record is removed, terminal state makes replay safe.
    await queue.remove(uploadId);
    await harness.prisma.db.outboxEvent.updateMany({
      where: { aggregateId: uploadId },
      data: { publishedAt: null },
    });
    expect(await runtime.get(OutboxDispatcherService).dispatchBatch()).toBe(1);
    await completed();
    expect(notifications).toHaveLength(1);
    expect(
      (await harness.prisma.db.upload.findUniqueOrThrow({ where: { id: uploadId } })).thumbnailKey,
    ).toBe(row.thumbnailKey);
  });

  it("retries a real storage failure from PROCESSING and reaches READY after recovery", async () => {
    await storage.delete(stagingKey);
    await dispatchAndStart();
    await expect
      .poll(async () => (await queue.getJob(uploadId))?.attemptsMade, { timeout: 5_000 })
      .toBeGreaterThanOrEqual(1);
    expect(
      (await harness.prisma.db.upload.findUniqueOrThrow({ where: { id: uploadId } })).status,
    ).toBe("PROCESSING");
    expect(notifications).toHaveLength(0);
    await storage.write(stagingKey, bytes, "image/png");
    await completed();
    await expect
      .poll(() => notifications)
      .toEqual([{ uploadId, ownerId: server.ownerId, status: "READY" }]);
  });

  it("retains a committed outbox event while Redis is unavailable and processes it after recovery", async () => {
    redisProxy.fault("disconnect");
    expect(await runtime.get(OutboxDispatcherService).dispatchBatch()).toBe(0);
    expect(
      await harness.prisma.client.outboxEvent.findFirstOrThrow({
        where: { aggregateId: uploadId },
      }),
    ).toMatchObject({ publishedAt: null });
    expect(
      (await harness.prisma.client.upload.findUniqueOrThrow({ where: { id: uploadId } })).status,
    ).toBe("UPLOADED");
    expect(await queue.getJob(uploadId)).toBeUndefined();
    redisProxy.fault("forward");
    await harness.prisma.db.outboxEvent.updateMany({
      where: { aggregateId: uploadId },
      data: { nextAttempt: new Date(0) },
    });
    await dispatchAndStart();
    await completed();
    await expect
      .poll(() => notifications)
      .toEqual([{ uploadId, ownerId: server.ownerId, status: "READY" }]);
  });

  it("completes a rejected job without a READY event or leftover object", async () => {
    await storage.write(stagingKey, Buffer.alloc(bytes.length), "image/png");
    await dispatchAndStart();
    await completed();
    expect(
      (await harness.prisma.db.upload.findUniqueOrThrow({ where: { id: uploadId } })).status,
    ).toBe("REJECTED");
    expect(await storage.head(stagingKey)).toBeNull();
    expect(notifications).toHaveLength(0);
  });

  it("keeps exhausted jobs inspectable without declaring an unprocessed upload READY", async () => {
    await storage.delete(stagingKey);
    await dispatchAndStart();
    await expect
      .poll(async () => (await queue.getJob(uploadId))?.getState(), { timeout: 25_000 })
      .toBe("failed");
    const job = await queue.getJob(uploadId);
    expect(job?.attemptsMade).toBe(5);
    expect(job?.failedReason).toContain("specified key does not exist");
    expect(
      (await harness.prisma.db.upload.findUniqueOrThrow({ where: { id: uploadId } })).status,
    ).toBe("PROCESSING");
    expect(notifications).toHaveLength(0);
  }, 30_000);

  it("bounds shutdown while a real job is blocked on a database row", async () => {
    let release: () => void = () => {};
    let locked: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holding = harness.prisma.client.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "uploads" WHERE "id" = ${uploadId} FOR UPDATE`;
        locked();
        await released;
      },
      { timeout: 15_000 },
    );
    let shutdown: Promise<void> | undefined;
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([ready, holding]);
      await dispatchAndStart();
      await expect.poll(async () => (await queue.getJob(uploadId))?.getState()).toBe("active");
      shutdown = runtime.get(UploadWorkerService).onModuleDestroy();
      const closed = await Promise.race([
        shutdown.then(() => true),
        new Promise<false>((resolve) => {
          timeout = setTimeout(() => resolve(false), 7_000);
        }),
      ]);
      expect(closed).toBe(true);
      expect(
        (await harness.prisma.db.upload.findUniqueOrThrow({ where: { id: uploadId } })).status,
      ).toBe("UPLOADED");
    } finally {
      if (timeout) clearTimeout(timeout);
      release();
      await holding;
      await shutdown;
      // Force-closing queue connections does not cancel the processor's current DB/S3 I/O.
      await expect.poll(async () => storage.head(stagingKey), { timeout: 10_000 }).toBeNull();
    }
  }, 20_000);
});
