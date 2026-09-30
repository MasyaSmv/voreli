import { createHash } from "node:crypto";

import { createId } from "@paralleldrive/cuid2";
import { encodeTextContent, Permission, serializePermissions } from "@voreli/shared";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { OBJECT_STORAGE, type ObjectStorage } from "../../src/infra/storage/object-storage.js";
import { DirectConversationService } from "../../src/modules/relationships/direct-conversation.service.js";
import { UploadProcessorService } from "../../src/modules/uploads/upload-processor.service.js";
import { UploadService } from "../../src/modules/uploads/upload.service.js";
import { Factories, type SeededUser } from "../support/factories.js";
import { createTestApp, type TestApp } from "../support/test-app.js";

describe("private attachment downloads", () => {
  let harness: TestApp;
  let storage: ObjectStorage;
  let author: SeededUser;
  let reader: SeededUser;
  let authorToken: string;
  let readerToken: string;
  let channelId: string;
  let messageId: string;
  let uploadId: string;
  let attachmentId: string;
  const keys = new Set<string>();
  const bytes = Buffer.from("Private attachment contents");
  const http = () => request(harness.app.getHttpServer());
  const download = (token: string, id = attachmentId) =>
    http().get(`/attachments/${id}/download`).set("Authorization", `Bearer ${token}`);

  async function login(user: SeededUser): Promise<string> {
    const result = await http()
      .post("/auth/login")
      .send({ username: user.username, password: user.password })
      .expect(200);
    return result.body.accessToken as string;
  }

  beforeAll(async () => {
    harness = await createTestApp();
    storage = harness.app.get<ObjectStorage>(OBJECT_STORAGE);
  });
  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.beginTransaction();
    const factories = new Factories(harness.prisma);
    const server = await factories.server();
    author = await factories.member(server);
    reader = await factories.member(server);
    authorToken = await login(author);
    readerToken = await login(reader);
    channelId = createId();
    messageId = createId();
    attachmentId = createId();
    await harness.prisma.db.channel.create({
      data: { id: channelId, serverId: server.serverId, name: "files", type: "TEXT" },
    });
    await harness.prisma.db.message.create({
      data: {
        id: messageId,
        channelId,
        authorId: author.id,
        content: Buffer.from(encodeTextContent("file")),
      },
    });
    const uploads = harness.app.get(UploadService);
    const reservation = await uploads.reserve(author.id, {
      fileName: "../личный файл.txt",
      byteSize: bytes.length,
      declaredMime: "text/plain",
      purpose: "attachment",
    });
    uploadId = reservation.uploadId;
    const staged = await harness.prisma.db.upload.findUniqueOrThrow({ where: { id: uploadId } });
    keys.add(staged.objectKey);
    await storage.write(staged.objectKey, bytes, "text/plain");
    await uploads.complete(author.id, uploadId, {
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    });
    await harness.app.get(UploadProcessorService).process(uploadId);
    const ready = await harness.prisma.db.upload.findUniqueOrThrow({ where: { id: uploadId } });
    keys.add(ready.objectKey);
    await harness.prisma.db.attachment.create({
      data: { id: attachmentId, uploadId, messageId, position: 0 },
    });
  });

  afterEach(async () => {
    for (const key of keys) await storage.delete(key);
    keys.clear();
    await harness.rollbackTransaction();
  });

  it("requires authentication and issues a non-cacheable five-minute download of the real private object", async () => {
    await http().get(`/attachments/${attachmentId}/download`).expect(401);
    const result = await download(readerToken).expect(302);
    expect(result.headers["cache-control"]).toBe("private, no-store");
    expect(result.headers["x-content-type-options"]).toBe("nosniff");
    const url = new URL(result.headers["location"] as string);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    const object = await fetch(url);
    expect(object.status).toBe(200);
    expect(object.headers.get("content-type")).toBe("application/octet-stream");
    expect(object.headers.get("cache-control")).toBe("private, no-store");
    expect(object.headers.get("x-content-type-options")).toBe("nosniff");
    expect(object.headers.get("content-disposition")).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent("личный файл.txt")}`,
    );
    expect(Buffer.from(await object.arrayBuffer())).toEqual(bytes);
    url.search = "";
    expect((await fetch(url)).status).toBe(403);
  });

  it("refuses a member of another server without leaking a signed URL", async () => {
    const factories = new Factories(harness.prisma);
    const other = await factories.member(await factories.server());
    const denied = await download(await login(other)).expect(404);
    expect(denied.headers["location"]).toBeUndefined();
    expect(denied.body.errorCode).toBe("ATTACHMENT_NOT_FOUND");
    await download(readerToken, createId()).expect(404);
  });

  it("revokes download access after ViewChannel changes, even for the upload author", async () => {
    await download(authorToken).expect(302);
    const channel = await harness.prisma.db.channel.findUniqueOrThrow({ where: { id: channelId } });
    const server = await harness.prisma.db.server.findUniqueOrThrow({
      where: { id: channel.serverId },
    });
    const owner = await harness.prisma.db.user.findUniqueOrThrow({ where: { id: server.ownerId } });
    const token = await login({
      id: owner.id,
      username: owner.username,
      password: "correct horse battery",
      memberId: "",
    });
    await http()
      .put(`/channels/${channelId}/overrides`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        memberId: author.memberId,
        allow: "0",
        deny: serializePermissions(Permission.ViewChannel),
      })
      .expect(204);
    await download(authorToken).expect(404);
    await download(readerToken).expect(302);
  });

  it("refuses a deleted message immediately while its object is retained", async () => {
    await http()
      .delete(`/messages/${messageId}`)
      .set("Authorization", `Bearer ${authorToken}`)
      .expect(204);
    await download(authorToken).expect(404);
    await download(readerToken).expect(404);
  });

  it.each(["RESERVED", "UPLOADED", "PROCESSING", "REJECTED", "EXPIRED"] as const)(
    "never serves an upload in %s",
    async (status) => {
      await harness.prisma.db.upload.update({ where: { id: uploadId }, data: { status } });
      await download(readerToken).expect(404);
    },
  );

  it("rejects an attachment linked to another author's upload", async () => {
    await harness.prisma.db.message.update({
      where: { id: messageId },
      data: { authorId: reader.id },
    });
    await download(readerToken).expect(404);
  });

  it("restricts direct-message downloads to participants with the same rules as history", async () => {
    const conversation = await harness.app
      .get(DirectConversationService)
      .findOrCreate(author.id, reader.id);
    await harness.prisma.db.message.update({
      where: { id: messageId },
      data: { channelId: null, directConversationId: conversation.id },
    });
    await download(authorToken).expect(302);
    await download(readerToken).expect(302);
    const factories = new Factories(harness.prisma);
    const stranger = await factories.member(await factories.server());
    const denied = await download(await login(stranger)).expect(404);
    expect(denied.body.errorCode).toBe("ATTACHMENT_NOT_FOUND");
  });
});
