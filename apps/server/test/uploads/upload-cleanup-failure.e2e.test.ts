import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { OBJECT_STORAGE, type ObjectStorage } from "../../src/infra/storage/object-storage.js";
import { UploadCleanupService } from "../../src/modules/uploads/upload-cleanup.service.js";
import { uploadObjectKeys } from "../../src/modules/uploads/upload-object-keys.js";
import { Factories } from "../support/factories.js";
import { createTestApp, type TestApp } from "../support/test-app.js";
import { faultyStorageCleanup } from "./faulty-storage-cleanup.js";
import { UploadFixture } from "./upload-fixture.js";

describe("upload cleanup recovery", () => {
  let harness: TestApp;
  let fixture: UploadFixture;
  beforeAll(async () => {
    harness = await createTestApp();
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

  it("persists an unsuccessful deletion, backs off, and retries a partial deletion after storage recovers", async () => {
    const upload = await fixture.ready();
    await fixture.age(upload.id);
    const faulty = await faultyStorageCleanup(harness);
    try {
      faulty.proxy.fault("disconnect");
      expect(await faulty.cleanup.cleanupExpired()).toBe(0);
      const failed = await fixture.row(upload.id);
      expect(failed).toMatchObject({
        status: "EXPIRED",
        objectDeletedAt: null,
        cleanupAttempts: 1,
      });
      expect(failed.cleanupRetryAt.getTime()).toBeGreaterThan(Date.now());
      expect(await faulty.cleanup.cleanupExpired()).toBe(0);
      const storage = harness.app.get<ObjectStorage>(OBJECT_STORAGE);
      expect(await storage.head(upload.objectKey)).not.toBeNull();
      await storage.delete(uploadObjectKeys(upload).thumbnail);
      await harness.prisma.db.upload.update({
        where: { id: upload.id },
        data: { cleanupRetryAt: new Date(0) },
      });
      expect(await harness.app.get(UploadCleanupService).cleanupExpired()).toBe(1);
      expect((await fixture.row(upload.id)).objectDeletedAt).not.toBeNull();
      expect(await storage.head(upload.objectKey)).toBeNull();
      expect(await harness.app.get(UploadCleanupService).cleanupExpired()).toBe(0);
    } finally {
      await faulty.close();
    }
  });
});
