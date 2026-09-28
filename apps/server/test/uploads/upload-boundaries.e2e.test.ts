import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { OBJECT_STORAGE, type ObjectStorage } from "../../src/infra/storage/object-storage.js";
import { AvatarService } from "../../src/modules/uploads/avatar.service.js";
import { UploadLifecycleService } from "../../src/modules/uploads/upload-lifecycle.service.js";
import { uploadObjectKeys } from "../../src/modules/uploads/upload-object-keys.js";
import { UploadProcessorService } from "../../src/modules/uploads/upload-processor.service.js";
import { UploadService } from "../../src/modules/uploads/upload.service.js";
import { Factories, type SeededServer } from "../support/factories.js";
import { createTestApp, type TestApp } from "../support/test-app.js";

describe("upload boundaries with real object storage", () => {
  let harness: TestApp;
  let server: SeededServer;
  let uploads: UploadService;
  let storage: ObjectStorage;
  const keys = new Set<string>();
  beforeAll(async () => {
    harness = await createTestApp();
    uploads = harness.app.get(UploadService);
    storage = harness.app.get<ObjectStorage>(OBJECT_STORAGE);
  });
  afterAll(() => harness.close());
  beforeEach(async () => {
    await harness.beginTransaction();
    server = await new Factories(harness.prisma).server();
  });
  afterEach(async () => {
    for (const key of keys) await storage.delete(key);
    keys.clear();
    await harness.rollbackTransaction();
  });

  async function reserve(bytes: Buffer, fileName = "note.txt", declaredMime = "text/plain") {
    const reservation = await uploads.reserve(server.ownerId, {
      fileName,
      declaredMime,
      byteSize: bytes.length,
      purpose: "attachment",
    });
    const row = await harness.prisma.db.upload.findUniqueOrThrow({
      where: { id: reservation.uploadId },
    });
    for (const key of Object.values(uploadObjectKeys(row))) keys.add(key);
    return { reservation, row };
  }
  async function stage(bytes: Buffer, fileName = "note.txt", declaredMime = "text/plain") {
    const result = await reserve(bytes, fileName, declaredMime);
    await storage.write(result.row.objectKey, bytes, declaredMime);
    await uploads.complete(server.ownerId, result.row.id, {
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    });
    return result.row;
  }

  it("refuses another user's status, complete and avatar binding", async () => {
    const { row } = await reserve(Buffer.from("data"));
    const other = await new Factories(harness.prisma).member(server);
    await expect(uploads.get(other.id, row.id)).rejects.toMatchObject({
      errorCode: "UPLOAD_NOT_OWNED",
    });
    await expect(
      uploads.complete(other.id, row.id, { checksumSha256: "0".repeat(64) }),
    ).rejects.toMatchObject({ errorCode: "UPLOAD_NOT_OWNED" });
    await expect(harness.app.get(AvatarService).set(other.id, row.id)).rejects.toMatchObject({
      errorCode: "UPLOAD_NOT_OWNED",
    });
  });

  it("enforces reservation quota and rejects completion after expiry", async () => {
    for (let count = 0; count < 20; count++) await reserve(Buffer.from("data"));
    await expect(reserve(Buffer.from("more"))).rejects.toMatchObject({
      errorCode: "TOO_MANY_ACTIVE_UPLOADS",
    });
    const row = await harness.prisma.db.upload.findFirstOrThrow({
      where: { ownerId: server.ownerId },
    });
    await harness.prisma.db.upload.update({
      where: { id: row.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(
      uploads.complete(server.ownerId, row.id, { checksumSha256: "0".repeat(64) }),
    ).rejects.toMatchObject({ errorCode: "UPLOAD_EXPIRED" });
    expect((await uploads.get(server.ownerId, row.id)).status).toBe("expired");
  });

  it("rechecks expiry at the lifecycle transition without publishing expired work", async () => {
    const { row } = await reserve(Buffer.from("data"));
    await storage.write(row.objectKey, Buffer.from("data"), "text/plain");
    expect(await storage.head(row.objectKey)).toMatchObject({ byteSize: 4 });
    await harness.prisma.db.upload.update({
      where: { id: row.id },
      data: { expiresAt: new Date(0) },
    });
    const completed = await harness.app
      .get(UploadLifecycleService)
      .complete(row.id, server.ownerId, createHash("sha256").update("data").digest("hex"));
    expect(completed.status).toBe("EXPIRED");
    expect(await harness.prisma.db.outboxEvent.count({ where: { aggregateId: row.id } })).toBe(0);
  });

  it("keeps complete idempotent after an accepted reservation's deadline", async () => {
    const row = await stage(Buffer.from("data"));
    await harness.prisma.db.upload.update({
      where: { id: row.id },
      data: { expiresAt: new Date(0) },
    });
    const completed = await harness.app
      .get(UploadLifecycleService)
      .complete(row.id, server.ownerId, "0".repeat(64));
    expect(completed.status).toBe("UPLOADED");
    expect(completed.checksumSha256).toBe(createHash("sha256").update("data").digest("hex"));
    expect(await harness.prisma.db.outboxEvent.count({ where: { aggregateId: row.id } })).toBe(1);
  });

  it.each(["key", "size"] as const)(
    "MinIO enforces the signed POST %s constraint",
    async (change) => {
      const { reservation, row } = await reserve(Buffer.from("data"));
      const forbiddenKey = `${row.objectKey}-forbidden`;
      keys.add(forbiddenKey);
      const form = new FormData();
      for (const [name, value] of Object.entries(reservation.upload.fields)) {
        form.append(name, change === "key" && name === "key" ? forbiddenKey : value);
      }
      form.append("file", new Blob([change === "size" ? "oversized" : "data"]), "note.txt");
      const response = await fetch(reservation.upload.url, { method: "POST", body: form });
      expect([400, 403]).toContain(response.status);
      expect(await storage.head(forbiddenKey)).toBeNull();
      expect(await storage.head(row.objectKey)).toBeNull();
    },
  );

  it("checks HEAD size and rechecks the bytes if staging changes after complete", async () => {
    const { row } = await reserve(Buffer.from("data"));
    await storage.write(row.objectKey, Buffer.from("different size"), "text/plain");
    await expect(
      uploads.complete(server.ownerId, row.id, { checksumSha256: "0".repeat(64) }),
    ).rejects.toMatchObject({ errorCode: "UPLOAD_SIZE_MISMATCH" });
    await storage.write(row.objectKey, Buffer.from("data"), "text/plain");
    await uploads.complete(server.ownerId, row.id, {
      checksumSha256: createHash("sha256").update("data").digest("hex"),
    });
    await storage.write(row.objectKey, Buffer.from("different size"), "text/plain");
    await harness.app.get(UploadProcessorService).process(row.id);
    expect(await uploads.get(server.ownerId, row.id)).toMatchObject({
      status: "rejected",
      rejectionCode: "SIZE_MISMATCH",
    });
    expect(await storage.head(row.objectKey)).toBeNull();
  });

  it.each(["jpeg", "gif", "webp"] as const)(
    "makes a safe preview from a real %s",
    async (format) => {
      const bytes = await sharp({
        create: { width: 12, height: 8, channels: 3, background: "red" },
      })
        .toFormat(format)
        .toBuffer();
      const row = await stage(bytes, `image.${format}`, `image/${format}`);
      await harness.app.get(UploadProcessorService).process(row.id);
      expect(await uploads.get(server.ownerId, row.id)).toMatchObject({
        status: "ready",
        detectedMime: `image/${format}`,
        width: 12,
        height: 8,
      });
      const ready = await harness.prisma.db.upload.findUniqueOrThrow({ where: { id: row.id } });
      expect(await storage.head(ready.thumbnailKey ?? "")).toMatchObject({
        contentType: "image/webp",
      });
      await expect(
        harness.app.get(AvatarService).set(server.ownerId, row.id),
      ).rejects.toMatchObject({ errorCode: "UPLOAD_NOT_READY" });
    },
  );

  it("retains download-only text without creating an image preview", async () => {
    const row = await stage(Buffer.from("A plain text attachment.\n"));
    await harness.app.get(UploadProcessorService).process(row.id);
    expect(await uploads.get(server.ownerId, row.id)).toMatchObject({
      status: "ready",
      detectedMime: "text/plain",
      width: null,
      height: null,
    });
    expect(
      (await harness.prisma.db.upload.findUniqueOrThrow({ where: { id: row.id } })).thumbnailKey,
    ).toBeNull();
  });

  it("processes a real PDF as download-only content", async () => {
    const bytes = await readFile(new URL("./fixtures/blank.pdf", import.meta.url));
    const row = await stage(bytes, "blank.pdf", "application/pdf");
    await harness.app.get(UploadProcessorService).process(row.id);
    expect(await uploads.get(server.ownerId, row.id)).toMatchObject({
      status: "ready",
      detectedMime: "application/pdf",
      width: null,
      height: null,
    });
    const ready = await harness.prisma.db.upload.findUniqueOrThrow({ where: { id: row.id } });
    expect(ready.thumbnailKey).toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of await storage.read(ready.objectKey))
      chunks.push(Buffer.from(chunk as Uint8Array));
    expect(Buffer.concat(chunks)).toEqual(bytes);
  });
});
