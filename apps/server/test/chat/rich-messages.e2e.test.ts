import { createId } from "@paralleldrive/cuid2";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Factories, type SeededServer } from "../support/factories.js";
import { createTestApp, type TestApp } from "../support/test-app.js";
import { UploadFixture } from "../uploads/upload-fixture.js";
import { MessageCompositionService } from "../../src/modules/chat/message-composition.service.js";
import { MessageService } from "../../src/modules/chat/message.service.js";
import { MessageHistoryService } from "../../src/modules/chat/message-history.service.js";
import { MessagePresenter } from "../../src/modules/chat/message-presenter.js";
import { ReactionService } from "../../src/modules/chat/reaction.service.js";
import { AttachmentAccessPolicy } from "../../src/modules/uploads/attachment-access.policy.js";
import { AttachmentDownloadService } from "../../src/modules/uploads/attachment-download.service.js";

describe("rich channel messages", () => {
  let harness: TestApp;
  let server: SeededServer;
  let channelId: string;
  let files: UploadFixture;
  beforeAll(async () => {
    harness = await createTestApp();
  });
  afterAll(async () => {
    await harness.close();
  });
  beforeEach(async () => {
    await harness.beginTransaction();
    server = await new Factories(harness.prisma).server();
    channelId = createId();
    await harness.prisma.db.channel.create({
      data: { id: channelId, serverId: server.serverId, name: "rich", type: "TEXT" },
    });
    files = new UploadFixture(harness, server.ownerId, server.serverId);
  });
  afterEach(async () => {
    await files.dispose();
    await harness.rollbackTransaction();
  });
  const send = (
    text: string,
    extra: { attachmentIds?: string[]; replyToId?: string; clientNonce?: string } = {},
  ) =>
    harness.app
      .get(MessageCompositionService)
      .send({ channelId, authorId: server.ownerId, text, ...extra });

  it("binds ready files atomically, handles retries, serves private preview and revokes it on delete", async () => {
    const upload = await files.ready();
    const message = await send("", { attachmentIds: [upload.id], clientNonce: "retry" });
    expect((await send("", { attachmentIds: [upload.id], clientNonce: "retry" })).id).toBe(
      message.id,
    );
    await expect(send("again", { attachmentIds: [upload.id] })).rejects.toMatchObject({
      errorCode: "ATTACHMENT_ALREADY_USED",
    });
    const view = await harness.app.get(MessagePresenter).enriched(message);
    expect(view.attachments).toHaveLength(1);
    const attachmentId = view.attachments[0]!.id;
    const policy = harness.app.get(AttachmentAccessPolicy);
    const accessible = await policy.authorize(attachmentId, server.ownerId);
    const url = await harness.app.get(AttachmentDownloadService).previewUrl(accessible);
    expect((await fetch(url)).status).toBe(200);
    const reply = await send("reply", { replyToId: message.id });
    expect((await harness.app.get(MessagePresenter).enriched(reply)).reply?.textPreview).toBe(
      "image.png",
    );
    await harness.app.get(MessageService).remove(message.id);
    await expect(policy.authorize(attachmentId, server.ownerId)).rejects.toMatchObject({
      errorCode: "ATTACHMENT_NOT_FOUND",
    });
    const page = await harness.app.get(MessageHistoryService).history({ channelId });
    const views = await harness.app.get(MessagePresenter).page(page.messages, server.ownerId);
    expect(views.find((item) => item.id === message.id)).toMatchObject({
      deletedAt: expect.any(String),
      body: { kind: "text", text: "" },
      attachments: [],
      reactions: [],
    });
    expect(views.find((item) => item.id === reply.id)?.reply).toMatchObject({
      deleted: true,
      textPreview: "",
    });
  });

  it("rejects non-ready, foreign and avatar uploads", async () => {
    const upload = await files.ready("avatar");
    await expect(send("", { attachmentIds: [upload.id] })).rejects.toMatchObject({
      errorCode: "UPLOAD_NOT_READY",
    });
    const file = await files.ready();
    const member = await new Factories(harness.prisma).member(server);
    await expect(
      harness.app
        .get(MessageCompositionService)
        .send({ channelId, authorId: member.id, text: "", attachmentIds: [file.id] }),
    ).rejects.toMatchObject({ errorCode: "UPLOAD_NOT_OWNED" });
    await harness.prisma.db.upload.update({
      where: { id: file.id },
      data: { status: "PROCESSING" },
    });
    await expect(send("", { attachmentIds: [file.id] })).rejects.toMatchObject({
      errorCode: "UPLOAD_NOT_READY",
    });
  });

  it("keeps reaction add/remove idempotent and personalizes the read model", async () => {
    const message = await send("react");
    const reactions = harness.app.get(ReactionService);
    const payload = { channelId, messageId: message.id, emoji: "👍" };
    expect((await reactions.change(server.ownerId, payload, true)).count).toBe(1);
    expect((await reactions.change(server.ownerId, payload, true)).count).toBe(1);
    expect(
      (await harness.app.get(MessagePresenter).enriched(message, null, server.ownerId)).reactions,
    ).toEqual([{ emoji: "👍", count: 1, reactedByCurrentUser: true }]);
    expect((await reactions.change(server.ownerId, payload, false)).count).toBe(0);
    expect((await reactions.change(server.ownerId, payload, false)).count).toBe(0);
    await harness.app.get(MessageService).remove(message.id);
    await expect(reactions.change(server.ownerId, payload, true)).rejects.toMatchObject({
      errorCode: "MESSAGE_NOT_FOUND",
    });
  });

  it("enforces reaction limits and rejects system and cross-channel targets", async () => {
    const message = await send("limits");
    const emojis = [
      "👍",
      "❤️",
      "😂",
      "🎉",
      "😮",
      "😢",
      "🔥",
      "👀",
      "😀",
      "😁",
      "😆",
      "😅",
      "🙂",
      "🙃",
      "😉",
      "😊",
      "🥰",
      "😍",
      "🤩",
      "😘",
    ];
    const reactions = harness.app.get(ReactionService);
    for (const emoji of emojis)
      await reactions.change(server.ownerId, { channelId, messageId: message.id, emoji }, true);
    await expect(
      reactions.change(server.ownerId, { channelId, messageId: message.id, emoji: "😎" }, true),
    ).rejects.toMatchObject({ errorCode: "REACTION_LIMIT" });
    expect(
      (
        await reactions.change(
          server.ownerId,
          { channelId, messageId: message.id, emoji: "👍" },
          true,
        )
      ).count,
    ).toBe(1);
    const system = await send("system");
    await harness.prisma.db.message.update({
      where: { id: system.id },
      data: { contentSchema: "system/call/v1" },
    });
    await expect(send("reply", { replyToId: system.id })).rejects.toMatchObject({
      errorCode: "SYSTEM_MESSAGE_IMMUTABLE",
    });
    await expect(
      reactions.change(server.ownerId, { channelId, messageId: system.id, emoji: "👍" }, true),
    ).rejects.toMatchObject({ errorCode: "SYSTEM_MESSAGE_IMMUTABLE" });
    const otherChannel = createId();
    await harness.prisma.db.channel.create({
      data: { id: otherChannel, serverId: server.serverId, name: "other", type: "TEXT" },
    });
    await expect(
      harness.app.get(MessageCompositionService).send({
        channelId: otherChannel,
        authorId: server.ownerId,
        text: "reply",
        replyToId: message.id,
      }),
    ).rejects.toMatchObject({ errorCode: "REPLY_TARGET_NOT_IN_CHANNEL" });
  });

  it("uses a fixed query count for a populated page", async () => {
    const root = await send("root");
    const messageIds: string[] = [];
    for (let index = 0; index < 50; index++) {
      const message = await send(`message ${index}`, { replyToId: root.id });
      messageIds.push(message.id);
      await harness.prisma.db.messageReaction.createMany({
        data: ["👍", "❤️", "🎉"].map((emoji) => ({
          messageId: message.id,
          userId: server.ownerId,
          emoji,
        })),
      });
    }
    const expiresAt = new Date(Date.now() + 60_000);
    await harness.prisma.db.upload.createMany({
      data: messageIds.map((messageId) => ({
        id: `upload-${messageId}`,
        ownerId: server.ownerId,
        purpose: "ATTACHMENT",
        status: "READY",
        originalName: "file.txt",
        declaredMime: "text/plain",
        detectedMime: "text/plain",
        byteSize: 4,
        objectKey: `query-budget/${messageId}`,
        expiresAt,
      })),
    });
    await harness.prisma.db.attachment.createMany({
      data: messageIds.map((messageId) => ({
        id: createId(),
        uploadId: `upload-${messageId}`,
        messageId,
        position: 0,
      })),
    });
    const page = await harness.app.get(MessageHistoryService).history({ channelId, limit: 50 });
    let queries = 0;
    const count = () => {
      queries++;
    };
    harness.prisma.client.$on("query", count);
    const presenter = harness.app.get(MessagePresenter);
    queries = 0;
    await presenter.page(page.messages.slice(0, 1), server.ownerId);
    const small = queries;
    queries = 0;
    const views = await presenter.page(page.messages, server.ownerId);
    const large = queries;
    expect(views).toHaveLength(50);
    expect(small).toBeLessThanOrEqual(8);
    expect(large).toBeLessThanOrEqual(8);
    expect(views[0]?.reactions).toHaveLength(3);
    expect(views[0]?.attachments).toHaveLength(1);
  });
});
