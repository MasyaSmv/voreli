import {
  type Ack,
  CHAT_NAMESPACE,
  ClientEvent,
  ContactAudience,
  type DirectAccessRevokedEvent,
  type DirectMessageDeletedEvent,
  type MessageView,
  ServerEvent,
} from "@voreli/shared";
import { io, type Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Factories, type SeededServer, type SeededUser } from "../support/factories.js";
import { createTestApp, type TestApp } from "../support/test-app.js";

describe("direct message realtime", () => {
  let harness: TestApp;
  let factories: Factories;
  let server: SeededServer;
  let alice: SeededUser;
  let bob: SeededUser;
  let charlie: SeededUser;
  let aliceToken: string;
  let bobToken: string;
  let charlieToken: string;
  let conversationId: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    harness = await createTestApp();
    factories = new Factories(harness.prisma);
    server = await factories.server();
    alice = await factories.member(server);
    bob = await factories.member(server);
    charlie = await factories.member(server);
    await harness.listen();
    await harness.resetRateLimits();
    aliceToken = await login(alice);
    bobToken = await login(bob);
    charlieToken = await login(charlie);

    const conversation = await request(harness.app.getHttpServer())
      .post("/direct-conversations")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ username: bob.username })
      .expect(201);
    conversationId = conversation.body.id as string;
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    await harness.prisma.db.server.delete({ where: { id: server.serverId } });
    await harness.prisma.db.directConversation.delete({ where: { id: conversationId } });
    await harness.prisma.db.user.deleteMany({
      where: { id: { in: [server.ownerId, alice.id, bob.id, charlie.id] } },
    });
    await harness.close();
  });

  async function login(user: SeededUser): Promise<string> {
    const response = await request(harness.app.getHttpServer())
      .post("/auth/login")
      .send({ username: user.username, password: user.password })
      .expect(200);
    return response.body.accessToken as string;
  }

  function connect(token: string): Socket {
    const socket = io(`http://127.0.0.1:${String(harness.port())}${CHAT_NAMESPACE}`, {
      transports: ["websocket"],
      auth: { token },
      forceNew: true,
    });
    sockets.push(socket);
    return socket;
  }

  function connected(socket: Socket): Promise<void> {
    return new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
  }

  function waitFor<T>(socket: Socket, event: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 4000);
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  it("delivers DM once, tracks unread and immediately revokes a disallowed sender", async () => {
    const aliceSocket = connect(aliceToken);
    const bobSocket = connect(bobToken);
    await Promise.all([connected(aliceSocket), connected(bobSocket)]);

    const aliceSubscription: Ack<{ conversationId: string }> = await aliceSocket.emitWithAck(
      ClientEvent.DirectSubscribe,
      { conversationId },
    );
    const bobSubscription: Ack<{ conversationId: string }> = await bobSocket.emitWithAck(
      ClientEvent.DirectSubscribe,
      { conversationId },
    );
    expect(aliceSubscription.ok).toBe(true);
    expect(bobSubscription.ok).toBe(true);

    const charlieSocket = connect(charlieToken);
    await connected(charlieSocket);
    const foreignSubscription: Ack<{ conversationId: string }> = await charlieSocket.emitWithAck(
      ClientEvent.DirectSubscribe,
      { conversationId },
    );
    expect(foreignSubscription).toMatchObject({
      ok: false,
      errorCode: "DIRECT_CONVERSATION_NOT_FOUND",
    });

    const incoming = waitFor<MessageView>(bobSocket, ServerEvent.DirectMessageNew);
    const first: Ack<{ message: MessageView }> = await aliceSocket.emitWithAck(
      ClientEvent.DirectSendMessage,
      { conversationId, text: "hello by username", clientNonce: "direct-nonce-1" },
    );
    expect(first.ok).toBe(true);
    expect((await incoming).text).toBe("hello by username");

    const retried: Ack<{ message: MessageView }> = await aliceSocket.emitWithAck(
      ClientEvent.DirectSendMessage,
      { conversationId, text: "hello by username", clientNonce: "direct-nonce-1" },
    );
    expect(retried.ok).toBe(true);
    if (first.ok && retried.ok) expect(retried.data.message.id).toBe(first.data.message.id);
    expect(
      await harness.prisma.db.message.count({ where: { directConversationId: conversationId } }),
    ).toBe(1);

    const reply: Ack<{ message: MessageView }> = await aliceSocket.emitWithAck(
      ClientEvent.DirectSendMessage,
      {
        conversationId,
        text: "reply in the same shared message model",
        replyToId: first.ok ? first.data.message.id : "unreachable",
        clientNonce: "direct-nonce-reply",
      },
    );
    expect(reply.ok).toBe(true);
    if (!reply.ok) throw new Error("Expected direct reply to succeed");
    expect(reply.data.message.replyToId).toBe(first.ok ? first.data.message.id : "unreachable");

    const updated = waitFor<MessageView>(bobSocket, ServerEvent.DirectMessageUpdated);
    await request(harness.app.getHttpServer())
      .patch(`/messages/${reply.data.message.id}`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ text: "edited direct reply" })
      .expect(200);
    await expect(updated).resolves.toMatchObject({
      id: reply.data.message.id,
      text: "edited direct reply",
    });

    const deleted = waitFor<DirectMessageDeletedEvent>(bobSocket, ServerEvent.DirectMessageDeleted);
    await request(harness.app.getHttpServer())
      .delete(`/messages/${reply.data.message.id}`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .expect(204);
    await expect(deleted).resolves.toEqual({
      conversationId,
      messageId: reply.data.message.id,
    });

    const conversationsBefore = await request(harness.app.getHttpServer())
      .get("/direct-conversations")
      .set("Authorization", `Bearer ${bobToken}`)
      .expect(200);
    expect(conversationsBefore.body[0].unreadCount).toBe(1);
    expect(conversationsBefore.body[0].lastMessage.text).toBe("hello by username");

    const read: Ack<null> = await bobSocket.emitWithAck(ClientEvent.DirectMarkRead, {
      conversationId,
      messageId: first.ok ? first.data.message.id : "unreachable",
    });
    expect(read.ok).toBe(true);

    const conversationsAfter = await request(harness.app.getHttpServer())
      .get("/direct-conversations")
      .set("Authorization", `Bearer ${bobToken}`)
      .expect(200);
    expect(conversationsAfter.body[0].unreadCount).toBe(0);

    const revoked = waitFor<DirectAccessRevokedEvent>(aliceSocket, ServerEvent.DirectAccessRevoked);
    await request(harness.app.getHttpServer())
      .patch("/users/me/contact-settings")
      .set("Authorization", `Bearer ${bobToken}`)
      .send({ directMessageAudience: ContactAudience.Nobody })
      .expect(200);
    await expect(revoked).resolves.toEqual({ conversationId });

    const refused: Ack<{ message: MessageView }> = await aliceSocket.emitWithAck(
      ClientEvent.DirectSendMessage,
      { conversationId, text: "must not arrive", clientNonce: "direct-nonce-2" },
    );
    expect(refused).toMatchObject({ ok: false, errorCode: "CONTACT_ACTION_NOT_ALLOWED" });

    await request(harness.app.getHttpServer())
      .patch("/users/me/contact-settings")
      .set("Authorization", `Bearer ${bobToken}`)
      .send({ directMessageAudience: ContactAudience.Everyone })
      .expect(200);

    const bobOtherDevice = connect(bobToken);
    await connected(bobOtherDevice);
    const requestOnOtherDevice = waitFor(bobOtherDevice, ServerEvent.RelationshipChanged);
    const friendRequest = await request(harness.app.getHttpServer())
      .post("/friend-requests")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ username: bob.username })
      .expect(201);
    await expect(requestOnOtherDevice).resolves.toEqual({});
    await request(harness.app.getHttpServer())
      .post(`/friend-requests/${friendRequest.body.id as string}/accept`)
      .set("Authorization", `Bearer ${bobToken}`)
      .expect(201);
    await request(harness.app.getHttpServer())
      .patch("/users/me/contact-settings")
      .set("Authorization", `Bearer ${bobToken}`)
      .send({ directMessageAudience: ContactAudience.Friends })
      .expect(200);

    const resubscribedAfterFriendship: Ack<{ conversationId: string }> =
      await aliceSocket.emitWithAck(ClientEvent.DirectSubscribe, { conversationId });
    expect(resubscribedAfterFriendship.ok).toBe(true);
    const revokedAfterUnfriend = waitFor<DirectAccessRevokedEvent>(
      aliceSocket,
      ServerEvent.DirectAccessRevoked,
    );
    await request(harness.app.getHttpServer())
      .delete(`/friends/${bob.username}`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .expect(204);
    await expect(revokedAfterUnfriend).resolves.toEqual({ conversationId });

    await request(harness.app.getHttpServer())
      .patch("/users/me/contact-settings")
      .set("Authorization", `Bearer ${bobToken}`)
      .send({ directMessageAudience: ContactAudience.Everyone })
      .expect(200);
    const resubscribedBeforeBlock: Ack<{ conversationId: string }> = await aliceSocket.emitWithAck(
      ClientEvent.DirectSubscribe,
      { conversationId },
    );
    expect(resubscribedBeforeBlock.ok).toBe(true);
    const revokedAfterBlock = waitFor<DirectAccessRevokedEvent>(
      aliceSocket,
      ServerEvent.DirectAccessRevoked,
    );
    await request(harness.app.getHttpServer())
      .post("/blocks")
      .set("Authorization", `Bearer ${bobToken}`)
      .send({ username: alice.username })
      .expect(204);
    await expect(revokedAfterBlock).resolves.toEqual({ conversationId });
  });
});
