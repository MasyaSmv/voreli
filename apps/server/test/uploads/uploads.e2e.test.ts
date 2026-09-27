import { createHash } from "node:crypto";

import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import type { UploadView } from "@voreli/shared";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { OBJECT_STORAGE, type ObjectStorage } from "../../src/infra/storage/object-storage.js";
import { AvatarContentService } from "../../src/modules/uploads/avatar-content.service.js";
import { AvatarService } from "../../src/modules/uploads/avatar.service.js";
import {
  OutboxDispatcherService,
  UPLOAD_QUEUE,
} from "../../src/modules/uploads/outbox-dispatcher.service.js";
import { UploadCleanupService } from "../../src/modules/uploads/upload-cleanup.service.js";
import { UploadProcessorService } from "../../src/modules/uploads/upload-processor.service.js";
import { UploadService } from "../../src/modules/uploads/upload.service.js";
import { Factories, type SeededServer, type SeededUser } from "../support/factories.js";
import { createTestApp, type TestApp } from "../support/test-app.js";

describe("upload pipeline", () => {
  let harness: TestApp;
  let factories: Factories;
  let server: SeededServer;
  let user: SeededUser;
  let uploads: UploadService;
  let processor: UploadProcessorService;
  let dispatcher: OutboxDispatcherService;
  let cleanup: UploadCleanupService;
  let avatars: AvatarService;
  let avatarContent: AvatarContentService;
  let storage: ObjectStorage;
  let queue: Queue;
  const objectKeys = new Set<string>();

  beforeAll(async () => {
    harness = await createTestApp();
    factories = new Factories(harness.prisma);
    uploads = harness.app.get(UploadService);
    processor = harness.app.get(UploadProcessorService);
    dispatcher = harness.app.get(OutboxDispatcherService);
    cleanup = harness.app.get(UploadCleanupService);
    avatars = harness.app.get(AvatarService);
    avatarContent = harness.app.get(AvatarContentService);
    storage = harness.app.get<ObjectStorage>(OBJECT_STORAGE);
    const config = harness.app.get(ConfigService);
    queue = new Queue(UPLOAD_QUEUE, {
      connection: { url: config.getOrThrow<string>("REDIS_URL") },
      prefix: config.getOrThrow<string>("QUEUE_PREFIX"),
    });
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
    await harness.close();
  });

  beforeEach(async () => {
    await harness.beginTransaction();
    server = await factories.server();
    user = await factories.member(server);
  });

  afterEach(async () => {
    for (const key of objectKeys) {
      await storage.delete(key);
    }
    objectKeys.clear();
    await harness.rollbackTransaction();
  });

  it("moves a real presigned PNG through Postgres, BullMQ and MinIO to READY", async () => {
    const image = await sharp({
      create: { width: 48, height: 32, channels: 3, background: "#5865f2" },
    })
      .png()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const checksumSha256 = createHash("sha256").update(image).digest("hex");

    const reservation = await uploads.reserve(user.id, {
      fileName: "avatar.png",
      byteSize: image.byteLength,
      declaredMime: "image/png",
      purpose: "avatar",
    });
    const staging = await harness.prisma.db.upload.findUniqueOrThrow({
      where: { id: reservation.uploadId },
    });
    objectKeys.add(staging.objectKey);

    const form = new FormData();
    for (const [name, value] of Object.entries(reservation.upload.fields)) {
      form.append(name, value);
    }
    form.append("file", new Blob([image], { type: "image/png" }), "avatar.png");
    const uploadResponse = await fetch(reservation.upload.url, { method: "POST", body: form });
    expect(uploadResponse.status).toBe(204);

    const completed = await uploads.complete(user.id, reservation.uploadId, { checksumSha256 });
    expect(completed.status).toBe("uploaded");
    expect(
      await harness.prisma.db.outboxEvent.count({
        where: { aggregateId: reservation.uploadId, publishedAt: null },
      }),
    ).toBe(1);
    expect(await dispatcher.dispatchBatch()).toBe(1);
    expect(await dispatcher.dispatchBatch()).toBe(0);

    await processor.process(reservation.uploadId);
    await processor.process(reservation.uploadId);

    const ready = await uploads.get(user.id, reservation.uploadId);
    expect(ready).toMatchObject<Partial<UploadView>>({
      status: "ready",
      detectedMime: "image/png",
      checksumSha256,
      width: 48,
      height: 32,
    });

    const row = await harness.prisma.db.upload.findUniqueOrThrow({
      where: { id: reservation.uploadId },
    });
    objectKeys.add(row.objectKey);
    expect(row.thumbnailKey).not.toBeNull();
    objectKeys.add(row.thumbnailKey ?? "");
    expect(await storage.head(row.objectKey)).toMatchObject({ byteSize: image.byteLength });
    expect((await storage.head(row.thumbnailKey ?? ""))?.contentType).toBe("image/webp");
    expect(await storage.head(staging.objectKey)).toBeNull();

    const publicUser = await avatars.set(user.id, reservation.uploadId);
    expect(publicUser.avatarUrl).toBe(`/uploads/${reservation.uploadId}/content`);
    const avatarResponse = await fetch(await avatarContent.redirectUrl(reservation.uploadId));
    expect(avatarResponse.status).toBe(200);
    expect(avatarResponse.headers.get("content-type")).toBe("image/webp");
  });

  it("rejects content whose checksum changed after complete", async () => {
    const bytes = new TextEncoder().encode("safe text");
    const reservation = await uploads.reserve(user.id, {
      fileName: "note.txt",
      byteSize: bytes.byteLength,
      declaredMime: "text/plain",
      purpose: "attachment",
    });
    const row = await harness.prisma.db.upload.findUniqueOrThrow({
      where: { id: reservation.uploadId },
    });
    objectKeys.add(row.objectKey);

    const form = new FormData();
    for (const [name, value] of Object.entries(reservation.upload.fields)) {
      form.append(name, value);
    }
    form.append("file", new Blob([bytes], { type: "text/plain" }), "note.txt");
    expect((await fetch(reservation.upload.url, { method: "POST", body: form })).status).toBe(204);

    await uploads.complete(user.id, reservation.uploadId, { checksumSha256: "0".repeat(64) });
    await processor.process(reservation.uploadId);

    expect((await uploads.get(user.id, reservation.uploadId)).status).toBe("rejected");
    expect((await uploads.get(user.id, reservation.uploadId)).rejectionCode).toBe(
      "CHECKSUM_MISMATCH",
    );
    expect(await storage.head(row.objectKey)).toBeNull();
  });

  it.each([
    { name: "wrong signature", bytes: Buffer.from("this is not a png"), code: "TYPE_MISMATCH" },
    {
      name: "truncated signature",
      bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      code: "TYPE_MISMATCH",
    },
  ])("rejects $name and deletes its object", async ({ bytes, code }) => {
    const reservation = await uploads.reserve(user.id, {
      fileName: "image.png",
      byteSize: bytes.length,
      declaredMime: "image/png",
      purpose: "attachment",
    });
    const row = await harness.prisma.db.upload.findUniqueOrThrow({
      where: { id: reservation.uploadId },
    });
    objectKeys.add(row.objectKey);
    await storage.write(row.objectKey, bytes, "image/png");
    await uploads.complete(user.id, row.id, {
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    });
    await processor.process(row.id);
    expect(await uploads.get(user.id, row.id)).toMatchObject({
      status: "rejected",
      rejectionCode: code,
    });
    expect(await storage.head(row.objectKey)).toBeNull();
  });

  it("rejects a valid PNG beyond the decoded pixel budget and deletes staging", async () => {
    const bytes = await sharp({
      create: { width: 6_400, height: 6_400, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    const reservation = await uploads.reserve(user.id, {
      fileName: "large.png",
      byteSize: bytes.length,
      declaredMime: "image/png",
      purpose: "attachment",
    });
    const row = await harness.prisma.db.upload.findUniqueOrThrow({
      where: { id: reservation.uploadId },
    });
    objectKeys.add(row.objectKey);
    await storage.write(row.objectKey, bytes, "image/png");
    await uploads.complete(user.id, row.id, {
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    });
    await processor.process(row.id);
    expect(await uploads.get(user.id, row.id)).toMatchObject({
      status: "rejected",
      rejectionCode: "INVALID_IMAGE",
    });
    expect(await storage.head(row.objectKey)).toBeNull();
  });

  it("expires reservations idempotently and records physical cleanup", async () => {
    const reservation = await uploads.reserve(user.id, {
      fileName: "note.txt",
      byteSize: 4,
      declaredMime: "text/plain",
      purpose: "attachment",
    });
    await harness.prisma.db.upload.update({
      where: { id: reservation.uploadId },
      data: { expiresAt: new Date(0) },
    });

    expect(await cleanup.cleanupExpired()).toBe(1);
    expect(await cleanup.cleanupExpired()).toBe(0);
    expect(
      await harness.prisma.db.upload.findUniqueOrThrow({ where: { id: reservation.uploadId } }),
    ).toMatchObject({ status: "EXPIRED", objectDeletedAt: expect.any(Date) });
  });
});
