import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { OBJECT_STORAGE, type ObjectStorage } from "../../src/infra/storage/object-storage.js";
import { AvatarService } from "../../src/modules/uploads/avatar.service.js";
import { UploadCleanupQuery } from "../../src/modules/uploads/upload-cleanup.query.js";
import { UploadCleanupService } from "../../src/modules/uploads/upload-cleanup.service.js";
import { UploadLifecycleService } from "../../src/modules/uploads/upload-lifecycle.service.js";
import { UploadNotReadyError } from "../../src/modules/uploads/errors/upload-errors.js";
import { uploadObjectKeys } from "../../src/modules/uploads/upload-object-keys.js";
import { Factories } from "../support/factories.js";
import { createTestApp, type TestApp } from "../support/test-app.js";
import { UploadFixture } from "./upload-fixture.js";

describe("upload retention with real object storage", () => {
  let harness: TestApp;
  let fixture: UploadFixture;
  let cleanup: UploadCleanupService;
  let lifecycle: UploadLifecycleService;
  let storage: ObjectStorage;

  beforeAll(async () => {
    harness = await createTestApp();
    cleanup = harness.app.get(UploadCleanupService);
    lifecycle = harness.app.get(UploadLifecycleService);
    storage = harness.app.get<ObjectStorage>(OBJECT_STORAGE);
  });
  afterAll(async () => {
    await harness.close();
  });
  beforeEach(async () => {
    await harness.beginTransaction();
    const server = await new Factories(harness.prisma).server();
    fixture = new UploadFixture(harness, server.ownerId, server.serverId);
  });
  afterEach(async () => {
    await fixture.dispose();
    await harness.rollbackTransaction();
  });

  it("retains new READY uploads, then removes unbound originals and thumbnails exactly once", async () => {
    const upload = await fixture.ready();
    expect(upload.objectDeletedAt).toBeNull();
    expect(await cleanup.cleanupExpired()).toBe(0);
    await fixture.age(upload.id);
    expect(await cleanup.cleanupExpired()).toBe(1);
    expect(await cleanup.cleanupExpired()).toBe(0);
    expect(await fixture.row(upload.id)).toMatchObject({
      status: "EXPIRED",
      objectDeletedAt: expect.any(Date),
      stagingDeletedAt: expect.any(Date),
    });
    for (const key of Object.values(uploadObjectKeys(upload)))
      expect(await storage.head(key)).toBeNull();
  });

  it("keeps bound files while cleaning staging recreated after complete", async () => {
    const upload = await fixture.ready();
    await fixture.attach(upload);
    const keys = uploadObjectKeys(upload);
    await storage.write(keys.staging, Buffer.from("replayed POST"), "image/png");
    expect(await cleanup.cleanupExpired()).toBe(0);
    await fixture.age(upload.id);
    expect(await cleanup.cleanupExpired()).toBe(1);
    expect(await storage.head(keys.staging)).toBeNull();
    expect(await storage.head(keys.original)).not.toBeNull();
    expect(await storage.head(keys.thumbnail)).not.toBeNull();
    expect((await fixture.row(upload.id)).status).toBe("READY");
  });

  it("starts a fresh retention period when an avatar is replaced and preserves the active avatar", async () => {
    const avatars = harness.app.get(AvatarService);
    const previous = await fixture.ready("avatar");
    const current = await fixture.ready("avatar");
    await avatars.set(fixture.ownerId, previous.id);
    await fixture.age(previous.id);
    await avatars.set(fixture.ownerId, current.id);
    expect((await fixture.row(previous.id)).unreferencedAt?.getTime()).toBeGreaterThan(
      Date.now() - 5_000,
    );
    await cleanup.cleanupExpired();
    expect(await storage.head(previous.objectKey)).not.toBeNull();
    await fixture.age(previous.id);
    await fixture.age(current.id);
    await cleanup.cleanupExpired();
    expect(await storage.head(previous.objectKey)).toBeNull();
    expect(await storage.head(current.objectKey)).not.toBeNull();
  });

  it("retains soft-deleted attachments for 24 hours, regardless of the upload's age", async () => {
    const upload = await fixture.ready();
    const messageId = await fixture.attach(upload);
    await fixture.age(upload.id);
    await harness.prisma.db.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    });
    await cleanup.cleanupExpired();
    expect(await storage.head(upload.objectKey)).not.toBeNull();
    await harness.prisma.db.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(0) },
    });
    await cleanup.cleanupExpired();
    expect(await storage.head(upload.objectKey)).toBeNull();
    expect((await fixture.row(upload.id)).status).toBe("EXPIRED");
  });

  it("gives detached attachments a full retention period after a hard message deletion", async () => {
    const upload = await fixture.ready();
    const messageId = await fixture.attach(upload);
    await harness.prisma.db.message.delete({ where: { id: messageId } });
    await cleanup.cleanupExpired();
    expect((await fixture.row(upload.id)).unreferencedAt).not.toBeNull();
    expect(await storage.head(upload.objectKey)).not.toBeNull();
    await fixture.age(upload.id);
    await cleanup.cleanupExpired();
    expect(await storage.head(upload.objectKey)).toBeNull();
  });

  it("rechecks a stale discovery snapshot before retiring a newly bound upload", async () => {
    const upload = await fixture.ready("avatar");
    await fixture.age(upload.id);
    expect(
      (await harness.app.get(UploadCleanupQuery).due(100)).some((row) => row.id === upload.id),
    ).toBe(true);
    await harness.app.get(AvatarService).set(fixture.ownerId, upload.id);
    expect((await lifecycle.claimCleanup(upload.id))?.status).toBe("READY");
    expect(await storage.head(upload.objectKey)).not.toBeNull();
  });

  it("never binds an upload once cleanup claimed it, even before physical DELETE", async () => {
    const upload = await fixture.ready("avatar");
    await fixture.age(upload.id);
    expect((await lifecycle.claimCleanup(upload.id))?.status).toBe("EXPIRED");
    await expect(
      harness.app.get(AvatarService).set(fixture.ownerId, upload.id),
    ).rejects.toBeInstanceOf(UploadNotReadyError);
    expect(await storage.head(upload.objectKey)).not.toBeNull();
    await cleanup.cleanupExpired();
    expect(await storage.head(upload.objectKey)).toBeNull();
  });

  it("does not expire an in-flight processor", async () => {
    const upload = await fixture.ready();
    await fixture.age(upload.id);
    await harness.prisma.db.upload.update({
      where: { id: upload.id },
      data: { status: "PROCESSING" },
    });
    expect(await lifecycle.claimCleanup(upload.id)).toBeNull();
    expect(await cleanup.cleanupExpired()).toBe(0);
    expect(await storage.head(upload.objectKey)).not.toBeNull();
  });
});
