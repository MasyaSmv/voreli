import { ContactAudience } from "@voreli/shared";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Factories, type SeededUser } from "../support/factories.js";
import { createTestApp, type TestApp } from "../support/test-app.js";
import { MessageService } from "../../src/modules/chat/message.service.js";

describe("public usernames, contact privacy and relationships", () => {
  let harness: TestApp;
  let factories: Factories;
  let alice: SeededUser;
  let bob: SeededUser;
  let aliceToken: string;
  let bobToken: string;

  beforeAll(async () => {
    harness = await createTestApp();
    factories = new Factories(harness.prisma);
  });

  beforeEach(async () => {
    await harness.beginTransaction();
    const server = await factories.server();
    alice = await factories.member(server);
    bob = await factories.member(server);
    aliceToken = await login(alice);
    bobToken = await login(bob);
  });

  afterEach(async () => {
    await harness.rollbackTransaction();
  });

  afterAll(async () => {
    await harness.close();
  });

  function http() {
    return request(harness.app.getHttpServer());
  }

  async function login(user: SeededUser): Promise<string> {
    const response = await http()
      .post("/auth/login")
      .send({ username: user.username, password: user.password })
      .expect(200);
    return response.body.accessToken as string;
  }

  it("finds only an exact public @username and exposes capabilities without an internal id", async () => {
    const found = await http()
      .get(`/users/lookup?username=@${bob.username.toUpperCase()}`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .expect(200);

    expect(found.body).toEqual({
      user: {
        username: bob.username,
        displayName: bob.username,
        avatarUrl: null,
        capabilities: { canMessage: true, canCall: true, canFriendRequest: true },
      },
    });
    expect(found.body.user).not.toHaveProperty("id");
    expect(found.body.user).not.toHaveProperty("email");

    await http()
      .get(`/users/lookup?username=${bob.username.slice(0, -1)}`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .expect(200, { user: null });
  });

  it("configures messages, calls and friend requests independently", async () => {
    await http()
      .patch("/users/me/contact-settings")
      .set("Authorization", `Bearer ${bobToken}`)
      .send({
        directMessageAudience: ContactAudience.Nobody,
        directCallAudience: ContactAudience.Everyone,
        friendRequestAudience: ContactAudience.Friends,
      })
      .expect(200);

    const lookup = await http()
      .get(`/users/lookup?username=${bob.username}`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .expect(200);

    expect(lookup.body.user.capabilities).toEqual({
      canMessage: false,
      canCall: true,
      canFriendRequest: false,
    });

    await http()
      .post("/friend-requests")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ username: bob.username })
      .expect(403);
  });

  it("creates one friendship and one conversation when the recipient accepts", async () => {
    const requested = await http()
      .post("/friend-requests")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ username: `@${bob.username}` })
      .expect(201);

    const pendingLookup = await http()
      .get(`/users/lookup?username=${bob.username}`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .expect(200);
    expect(pendingLookup.body.user.capabilities.canFriendRequest).toBe(false);

    const accepted = await http()
      .post(`/friend-requests/${requested.body.id as string}/accept`)
      .set("Authorization", `Bearer ${bobToken}`)
      .expect(201);

    expect(accepted.body.friend.username).toBe(alice.username);
    expect(accepted.body.conversation.participant.username).toBe(alice.username);
    const pairWhere = {
      OR: [
        { userLowId: alice.id, userHighId: bob.id },
        { userLowId: bob.id, userHighId: alice.id },
      ],
    };
    expect(await harness.prisma.db.friendship.count({ where: pairWhere })).toBe(1);
    expect(await harness.prisma.db.directConversation.count({ where: pairWhere })).toBe(1);

    await http()
      .post("/direct-conversations")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ username: bob.username })
      .expect(201);
    expect(await harness.prisma.db.directConversation.count({ where: pairWhere })).toBe(1);
  });

  it("uses friendship only for FRIENDS audiences and recalculates after unfriend", async () => {
    await http()
      .patch("/users/me/contact-settings")
      .set("Authorization", `Bearer ${bobToken}`)
      .send({ directMessageAudience: ContactAudience.Friends })
      .expect(200);

    const conversation = await http()
      .post("/direct-conversations")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ username: bob.username })
      .expect(201);

    await expect(
      harness.app.get(MessageService).sendDirect({
        conversationId: conversation.body.id as string,
        authorId: alice.id,
        text: "not allowed yet",
      }),
    ).rejects.toMatchObject({ errorCode: "CONTACT_ACTION_NOT_ALLOWED" });

    const requested = await http()
      .post("/friend-requests")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ username: bob.username })
      .expect(201);
    await http()
      .post(`/friend-requests/${requested.body.id as string}/accept`)
      .set("Authorization", `Bearer ${bobToken}`)
      .expect(201);

    await http()
      .post("/direct-conversations")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ username: bob.username })
      .expect(201);

    await http()
      .delete(`/friends/${bob.username}`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .expect(204);

    const lookup = await http()
      .get(`/users/lookup?username=${bob.username}`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .expect(200);
    expect(lookup.body.user.capabilities.canMessage).toBe(false);
  });

  it("makes a directional block override every audience until the blocker unblocks", async () => {
    await http()
      .post("/blocks")
      .set("Authorization", `Bearer ${bobToken}`)
      .send({ username: alice.username })
      .expect(204);

    await http()
      .get(`/users/lookup?username=${bob.username}`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .expect(200, { user: null });

    await http()
      .post("/direct-conversations")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ username: bob.username })
      .expect(404);

    await http()
      .delete(`/blocks/${alice.username}`)
      .set("Authorization", `Bearer ${bobToken}`)
      .expect(204);

    const visibleAgain = await http()
      .get(`/users/lookup?username=${bob.username}`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .expect(200);
    expect(visibleAgain.body.user.capabilities).toEqual({
      canMessage: true,
      canCall: true,
      canFriendRequest: true,
    });
    expect(
      await harness.prisma.db.userBlock.count({
        where: { blockerId: bob.id, blockedId: alice.id },
      }),
    ).toBe(0);
  });

  it("does not expose a direct conversation or its history to a third user", async () => {
    const charlie = await factories.member(await factories.server());
    const charlieToken = await login(charlie);
    const conversation = await http()
      .post("/direct-conversations")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ username: bob.username })
      .expect(201);

    await http()
      .get(`/direct-conversations/${conversation.body.id as string}/messages`)
      .set("Authorization", `Bearer ${charlieToken}`)
      .expect(404);

    await http()
      .patch(`/direct-conversations/${conversation.body.id as string}/read`)
      .set("Authorization", `Bearer ${charlieToken}`)
      .send({ messageId: "unknown-message" })
      .expect(404);
  });

  it("enforces canonical pairs and exactly one message container in PostgreSQL", async () => {
    const [userLowId, userHighId] = [alice.id, bob.id].sort();
    await expect(
      harness.prisma.db.friendship.create({
        data: { id: "bad-pair", userLowId: userHighId as string, userHighId: userLowId as string },
      }),
    ).rejects.toThrow();
  });

  it("rejects a message without exactly one container at the database boundary", async () => {
    await expect(
      harness.prisma.db.message.create({
        data: { id: "no-container", authorId: alice.id, content: Buffer.from("{}") },
      }),
    ).rejects.toThrow();
  });
});

function canonicalPair(firstUserId: string, secondUserId: string) {
  return firstUserId < secondUserId
    ? { userLowId: firstUserId, userHighId: secondUserId }
    : { userLowId: secondUserId, userHighId: firstUserId };
}

describe("relationship concurrency", () => {
  let harness: TestApp;
  let factories: Factories;
  let serverId: string;
  let ownerId: string;
  let alice: SeededUser;
  let bob: SeededUser;
  let aliceToken: string;
  let bobToken: string;

  beforeAll(async () => {
    harness = await createTestApp();
    factories = new Factories(harness.prisma);
    const server = await factories.server();
    serverId = server.serverId;
    ownerId = server.ownerId;
    alice = await factories.member(server);
    bob = await factories.member(server);
    await harness.resetRateLimits();
    aliceToken = await login(alice);
    bobToken = await login(bob);
  });

  afterAll(async () => {
    await harness.prisma.db.server.delete({ where: { id: serverId } });
    await harness.prisma.db.user.deleteMany({ where: { id: { in: [ownerId, alice.id, bob.id] } } });
    await harness.close();
  });

  function http() {
    return request(harness.app.getHttpServer());
  }

  async function login(user: SeededUser): Promise<string> {
    const response = await http()
      .post("/auth/login")
      .send({ username: user.username, password: user.password })
      .expect(200);
    return response.body.accessToken as string;
  }

  it("serializes crossed requests and concurrent accepts into one relationship", async () => {
    const crossed = await Promise.all([
      http()
        .post("/friend-requests")
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({ username: bob.username }),
      http()
        .post("/friend-requests")
        .set("Authorization", `Bearer ${bobToken}`)
        .send({ username: alice.username }),
    ]);

    expect(crossed.map((response) => response.status).sort()).toEqual([201, 409]);
    const createdIndex = crossed.findIndex((response) => response.status === 201);
    const created = crossed[createdIndex];
    expect(created).toBeDefined();
    const recipientToken = createdIndex === 0 ? bobToken : aliceToken;
    const requestId = created?.body.id as string;
    const pair = canonicalPair(alice.id, bob.id);
    expect(
      await harness.prisma.db.friendRequest.count({ where: { ...pair, status: "PENDING" } }),
    ).toBe(1);

    const accepts = await Promise.all([
      http()
        .post(`/friend-requests/${requestId}/accept`)
        .set("Authorization", `Bearer ${recipientToken}`),
      http()
        .post(`/friend-requests/${requestId}/accept`)
        .set("Authorization", `Bearer ${recipientToken}`),
    ]);

    expect(accepts.map((response) => response.status).sort()).toEqual([201, 404]);
    expect(await harness.prisma.db.friendship.count({ where: pair })).toBe(1);
    expect(await harness.prisma.db.directConversation.count({ where: pair })).toBe(1);
  });
});
