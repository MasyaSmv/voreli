import { createId } from "@paralleldrive/cuid2";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Factories, type SeededServer } from "../support/factories.js";
import { createTestApp, type TestApp } from "../support/test-app.js";
import { UploadFixture } from "../uploads/upload-fixture.js";
import { MessageCompositionService } from "../../src/modules/chat/message-composition.service.js";

describe("concurrent attachment claims on independent transactions", () => {
  let harness: TestApp;
  let server: SeededServer;
  let files: UploadFixture;
  let channelId: string;
  let uploadId: string;
  beforeAll(async () => {
    harness = await createTestApp();
  });
  afterAll(async () => {
    await harness.close();
  });
  beforeEach(async () => {
    server = await new Factories(harness.prisma).server();
    channelId = createId();
    await harness.prisma.db.channel.create({
      data: { id: channelId, serverId: server.serverId, name: "claims", type: "TEXT" },
    });
    files = new UploadFixture(harness, server.ownerId, server.serverId);
    uploadId = (await files.ready()).id;
  });
  afterEach(async () => {
    await files.dispose();
    await harness.prisma.db.outboxEvent.deleteMany({ where: { aggregateId: uploadId } });
    await harness.prisma.db.server.delete({ where: { id: server.serverId } });
    await harness.prisma.db.user.delete({ where: { id: server.ownerId } });
  });
  const send = (nonce: string) =>
    harness.app.get(MessageCompositionService).send({
      channelId,
      authorId: server.ownerId,
      text: "",
      attachmentIds: [uploadId],
      clientNonce: nonce,
    });
  it("allows exactly one competing claim and rolls back the losing message", async () => {
    const results = await Promise.allSettled([send("first"), send("second")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { errorCode: "ATTACHMENT_ALREADY_USED" },
    });
    expect(await harness.prisma.db.message.count({ where: { channelId } })).toBe(1);
    expect(await harness.prisma.db.attachment.count({ where: { uploadId } })).toBe(1);
  });
  it("returns one message for simultaneous retries of the same nonce", async () => {
    const [first, second] = await Promise.all([send("same"), send("same")]);
    expect(first.id).toBe(second.id);
    expect(await harness.prisma.db.message.count({ where: { channelId } })).toBe(1);
  });
});
