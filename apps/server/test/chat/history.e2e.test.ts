import { createId } from "@paralleldrive/cuid2";
import { encodeTextContent, Permission, serializePermissions } from "@voreli/shared";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Factories, type SeededServer, type SeededUser } from "../support/factories.js";
import { createTestApp, type TestApp } from "../support/test-app.js";

describe("message history and unread counts", () => {
  let harness: TestApp;
  let factories: Factories;
  let seeded: SeededServer;
  let owner: SeededUser;
  let ownerToken: string;
  let member: SeededUser;
  let memberToken: string;
  let channelId: string;

  beforeAll(async () => {
    harness = await createTestApp();
    factories = new Factories(harness.prisma);
  });

  afterAll(async () => {
    await harness.close();
  });

  const http = () => request(harness.app.getHttpServer());

  async function login(user: SeededUser): Promise<string> {
    const response = await http()
      .post("/auth/login")
      .send({ username: user.username, password: user.password })
      .expect(200);

    return response.body.accessToken as string;
  }

  /** Writes messages straight to the database: history is what is being tested, not sending. */
  async function seedMessages(count: number, authorId: string): Promise<string[]> {
    const ids: string[] = [];

    for (let index = 0; index < count; index += 1) {
      const id = createId();
      await harness.prisma.db.message.create({
        data: {
          id,
          channelId,
          authorId,
          content: Buffer.from(encodeTextContent(`message ${String(index)}`)),
          // Distinct timestamps so ordering is deterministic rather than insertion-order luck.
          createdAt: new Date(Date.now() + index * 1000),
        },
      });
      ids.push(id);
    }

    return ids;
  }

  beforeEach(async () => {
    await harness.beginTransaction();

    seeded = await factories.server();
    const ownerUser = await harness.prisma.db.user.findUniqueOrThrow({
      where: { id: seeded.ownerId },
    });
    owner = {
      id: ownerUser.id,
      username: ownerUser.username,
      password: "correct horse battery",
      memberId: "",
    };
    member = await factories.member(seeded);

    ownerToken = await login(owner);
    memberToken = await login(member);

    const channel = await http()
      .post(`/servers/${seeded.serverId}/channels`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "history", type: "TEXT" })
      .expect(201);

    channelId = channel.body.id as string;
  });

  afterEach(async () => {
    await harness.rollbackTransaction();
  });

  it("returns the newest messages first", async () => {
    await seedMessages(3, owner.id);

    const page = await http()
      .get(`/channels/${channelId}/messages`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);

    expect(page.body.messages).toHaveLength(3);
    expect(page.body.messages[0].text).toBe("message 2");
    expect(page.body.nextCursor).toBeNull();
  });

  it("pages backwards through history with a cursor and never repeats a message", async () => {
    await seedMessages(7, owner.id);

    const first = await http()
      .get(`/channels/${channelId}/messages?limit=3`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);

    expect(first.body.messages).toHaveLength(3);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await http()
      .get(`/channels/${channelId}/messages?limit=3&before=${first.body.nextCursor as string}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);

    const firstIds: string[] = first.body.messages.map((m: { id: string }): string => m.id);
    const secondIds: string[] = second.body.messages.map((m: { id: string }): string => m.id);

    expect(second.body.messages).toHaveLength(3);
    expect(firstIds.some((id: string) => secondIds.includes(id))).toBe(false);

    const third = await http()
      .get(`/channels/${channelId}/messages?limit=3&before=${second.body.nextCursor as string}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);

    expect(third.body.messages).toHaveLength(1);
    expect(third.body.nextCursor).toBeNull();
  });

  it("hides history of a channel the caller may not view", async () => {
    await seedMessages(2, owner.id);

    await http()
      .put(`/channels/${channelId}/overrides`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        memberId: member.memberId,
        allow: "0",
        deny: serializePermissions(Permission.ViewChannel),
      })
      .expect(204);

    await http()
      .get(`/channels/${channelId}/messages`)
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(404);
  });

  it("counts everything as unread until a read mark is set", async () => {
    const ids = await seedMessages(4, owner.id);

    const before = await http()
      .get(`/servers/${seeded.serverId}/unread`)
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(200);

    expect(
      before.body.channels.find((c: { channelId: string }) => c.channelId === channelId).count,
    ).toBe(4);

    await harness.prisma.db.channelRead.create({
      data: { memberId: member.memberId, channelId, lastReadMessageId: ids[1] as string },
    });

    const after = await http()
      .get(`/servers/${seeded.serverId}/unread`)
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(200);

    expect(
      after.body.channels.find((c: { channelId: string }) => c.channelId === channelId).count,
    ).toBe(2);
  });

  it("drops a channel from the unread list once it is fully read", async () => {
    const ids = await seedMessages(2, owner.id);

    await harness.prisma.db.channelRead.create({
      data: { memberId: member.memberId, channelId, lastReadMessageId: ids.at(-1) as string },
    });

    const unread = await http()
      .get(`/servers/${seeded.serverId}/unread`)
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(200);

    expect(
      unread.body.channels.find((c: { channelId: string }) => c.channelId === channelId),
    ).toBeUndefined();
  });

  it("lets an author edit their own message and refuses a stranger", async () => {
    const [messageId] = await seedMessages(1, owner.id);

    const edited = await http()
      .patch(`/messages/${messageId as string}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ text: "edited by author" })
      .expect(200);

    expect(edited.body.text).toBe("edited by author");
    expect(edited.body.editedAt).toEqual(expect.any(String));

    const refused = await http()
      .patch(`/messages/${messageId as string}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ text: "not mine" })
      .expect(403);

    expect(refused.body.errorCode).toBe("NOT_MESSAGE_AUTHOR");
  });

  it("lets MANAGE_MESSAGES delete someone else's message", async () => {
    const [messageId] = await seedMessages(1, owner.id);

    const moderator = await http()
      .post(`/servers/${seeded.serverId}/roles`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "moderator", permissions: serializePermissions(Permission.ManageMessages) })
      .expect(201);

    await http()
      .put(`/members/${member.memberId}/roles/${moderator.body.id as string}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(204);

    await http()
      .delete(`/messages/${messageId as string}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(204);

    const page = await http()
      .get(`/channels/${channelId}/messages`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);

    expect(page.body.messages).toHaveLength(0);
  });
});
