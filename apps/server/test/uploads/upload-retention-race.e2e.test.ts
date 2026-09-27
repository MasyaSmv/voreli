import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Test, type TestingModule } from "@nestjs/testing";

import { CommonModule } from "../../src/common/common.module.js";
import { DatabaseModule } from "../../src/infra/database/database.module.js";
import { PrismaService } from "../../src/infra/database/prisma.service.js";
import { AvatarService } from "../../src/modules/uploads/avatar.service.js";
import { UploadLifecycleService } from "../../src/modules/uploads/upload-lifecycle.service.js";
import { UploadNotReadyError } from "../../src/modules/uploads/errors/upload-errors.js";
import { Factories, type SeededServer } from "../support/factories.js";
import { createTestApp, type TestApp } from "../support/test-app.js";
import { UploadFixture } from "./upload-fixture.js";

/** Separate connections are necessary here: a shared rollback transaction cannot contend. */
describe("upload binding versus retirement row locks", () => {
  let writer: TestApp;
  let cleaner: TestingModule;
  let server: SeededServer;
  let fixture: UploadFixture;
  let uploadId: string;

  beforeAll(async () => {
    writer = await createTestApp();
    cleaner = await Test.createTestingModule({
      imports: [CommonModule, DatabaseModule],
      providers: [UploadLifecycleService],
    }).compile();
    await cleaner.init();
  });
  afterAll(async () => {
    await cleaner.close();
    await writer.close();
  });
  beforeEach(async () => {
    server = await new Factories(writer.prisma).server();
    fixture = new UploadFixture(writer, server.ownerId, server.serverId);
    uploadId = (await fixture.ready("avatar")).id;
    await fixture.age(uploadId);
  });
  afterEach(async () => {
    await fixture.dispose();
    await writer.prisma.db.outboxEvent.deleteMany({ where: { aggregateId: uploadId } });
    await writer.prisma.db.server.delete({ where: { id: server.serverId } });
    await writer.prisma.db.user.update({
      where: { id: server.ownerId },
      data: { avatarUploadId: null },
    });
    await writer.prisma.db.user.delete({ where: { id: server.ownerId } });
  });

  function hold(prisma: PrismaService, action: () => Promise<unknown>) {
    let release: () => void;
    let signal: (pid: number) => void;
    let fail: (error: unknown) => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<number>((resolve, reject) => {
      signal = resolve;
      fail = reject;
    });
    const result = prisma.runInTransaction(async () => {
      try {
        await action();
        const rows = await prisma.db.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        signal(rows[0]?.pid ?? 0);
        await released;
      } catch (error: unknown) {
        fail(error);
        throw error;
      }
    });
    return { ready, release: () => release(), result };
  }

  async function expectBlockedBy(pid: number): Promise<void> {
    await expect
      .poll(
        async () => {
          const rows = await writer.prisma.client.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))
      `;
          return rows[0]?.count ?? 0;
        },
        { timeout: 2_000, interval: 20 },
      )
      .toBeGreaterThan(0);
  }

  it("waits for avatar binding to commit and then preserves its upload", async () => {
    const binding = hold(writer.prisma, () =>
      writer.app.get(AvatarService).set(server.ownerId, uploadId),
    );
    const pid = await binding.ready;
    const retiring = cleaner.get(UploadLifecycleService).claimCleanup(uploadId);
    try {
      await expectBlockedBy(pid);
    } finally {
      binding.release();
      await binding.result;
    }
    expect((await retiring)?.status).toBe("READY");
    expect((await fixture.row(uploadId)).unreferencedAt).toBeNull();
  });

  it("waits for retirement to commit and then rejects avatar binding", async () => {
    const retirement = hold(cleaner.get(PrismaService), () =>
      cleaner.get(UploadLifecycleService).claimCleanup(uploadId),
    );
    const pid = await retirement.ready;
    const binding = writer.app.get(AvatarService).set(server.ownerId, uploadId);
    const refused = expect(binding).rejects.toBeInstanceOf(UploadNotReadyError);
    try {
      await expectBlockedBy(pid);
    } finally {
      retirement.release();
      await retirement.result;
    }
    await refused;
    expect((await fixture.row(uploadId)).status).toBe("EXPIRED");
  });
});
