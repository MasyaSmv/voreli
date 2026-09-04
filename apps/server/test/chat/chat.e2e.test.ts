import {
  type Ack,
  CHAT_NAMESPACE,
  type ChannelAccessRevokedEvent,
  ClientEvent,
  DEFAULT_EVERYONE_PERMISSIONS,
  type MessageView,
  Permission,
  REFRESH_COOKIE,
  serializePermissions,
  ServerEvent,
  type TypingEvent,
} from "@voreli/shared";
import { io, type Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../src/common/events/domain-event-bus.js";
import { AccessTokenService } from "../../src/modules/auth/access-token.service.js";
import { Factories, type SeededServer, type SeededUser } from "../support/factories.js";
import { createTestApp, type TestApp } from "../support/test-app.js";

/**
 * Runs against a real listening server and real Socket.IO clients, outside the per-test
 * transaction: a websocket upgrade cannot travel through supertest's in-memory transport,
 * and the gateway's own connections would not see uncommitted rows anyway. Cleans up after
 * itself.
 */
describe("realtime chat", () => {
  let harness: TestApp;
  let factories: Factories;
  let seeded: SeededServer;
  let alice: SeededUser;
  let bob: SeededUser;
  let aliceToken: string;
  let bobToken: string;
  let channelId: string;
  const sockets: Socket[] = [];
  const additionalUserIds: string[] = [];

  beforeAll(async () => {
    harness = await createTestApp();
    factories = new Factories(harness.prisma);
    seeded = await factories.server();
    alice = await factories.member(seeded);
    bob = await factories.member(seeded);

    await harness.listen();

    aliceToken = await login(alice);
    bobToken = await login(bob);

    const created = await request(harness.app.getHttpServer())
      .post(`/servers/${seeded.serverId}/channels`)
      .set("Authorization", `Bearer ${await login({ ...alice })}`)
      .send({ name: "chat", type: "TEXT" });

    // Alice is a plain member, so the channel is created by the owner instead.
    if (created.status !== 201) {
      const ownerUser = await harness.prisma.db.user.findUniqueOrThrow({
        where: { id: seeded.ownerId },
      });
      const ownerToken = await login({
        id: ownerUser.id,
        username: ownerUser.username,
        password: "correct horse battery",
        memberId: "",
      });

      const byOwner = await request(harness.app.getHttpServer())
        .post(`/servers/${seeded.serverId}/channels`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ name: "chat", type: "TEXT" })
        .expect(201);

      channelId = byOwner.body.id as string;
    } else {
      channelId = created.body.id as string;
    }
  });

  // This suite runs outside the per-test transaction, so nothing resets between tests. It
  // logs in repeatedly from one address, which is exactly what the login limiter exists to
  // stop — clear the counters the way the transactional suites do.
  beforeEach(async () => {
    await harness.resetRateLimits();
  });

  afterAll(async () => {
    for (const socket of sockets) {
      socket.disconnect();
    }

    await harness.prisma.db.server.delete({ where: { id: seeded.serverId } });
    await harness.prisma.db.user.deleteMany({
      where: { id: { in: [seeded.ownerId, alice.id, bob.id, ...additionalUserIds] } },
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

  async function loginAsOwner(): Promise<string> {
    const owner = await harness.prisma.db.user.findUniqueOrThrow({
      where: { id: seeded.ownerId },
    });

    return login({
      id: owner.id,
      username: owner.username,
      password: "correct horse battery",
      memberId: "",
    });
  }

  async function createMember(): Promise<SeededUser> {
    const member = await factories.member(seeded);
    additionalUserIds.push(member.id);

    return member;
  }

  function refreshCookieOf(response: { headers: Record<string, unknown> }): string {
    const cookies = response.headers["set-cookie"] as string[] | undefined;
    const cookie = cookies?.find((candidate) => candidate.startsWith(REFRESH_COOKIE));

    if (cookie === undefined) {
      throw new Error("Response carried no refresh cookie");
    }

    return cookie.split(";")[0] ?? "";
  }

  function connect(token: string | undefined): Socket {
    const socket = io(`http://127.0.0.1:${String(harness.port())}${CHAT_NAMESPACE}`, {
      transports: ["websocket"],
      auth: token === undefined ? {} : { token },
      forceNew: true,
    });

    sockets.push(socket);

    return socket;
  }

  function waitFor<T>(socket: Socket, event: string, timeoutMs = 4000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for ${event}`));
      }, timeoutMs);

      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  function connected(socket: Socket): Promise<void> {
    return new Promise((resolve, reject) => {
      socket.once("connect", () => {
        resolve();
      });
      socket.once("connect_error", reject);
    });
  }

  function disconnected(socket: Socket): Promise<string> {
    return waitFor<string>(socket, "disconnect");
  }

  it("refuses the handshake when no token is given", async () => {
    const socket = connect(undefined);

    await expect(connected(socket)).rejects.toThrow(/UNAUTHENTICATED/);
    expect(socket.connected).toBe(false);
  });

  it("refuses the handshake when the token is not a real token", async () => {
    const socket = connect("not-a-jwt");

    await expect(connected(socket)).rejects.toThrow(/UNAUTHENTICATED/);
    expect(socket.connected).toBe(false);
  });

  it("moves the socket to the rotated session while keeping the same user connected", async () => {
    const session = request.agent(harness.app.getHttpServer());
    const loggedIn = await session
      .post("/auth/login")
      .send({ username: alice.username, password: alice.password })
      .expect(200);
    const socket = connect(loggedIn.body.accessToken as string);
    await connected(socket);

    const refreshed = await session.post("/auth/refresh").expect(200);
    const tokens = harness.app.get(AccessTokenService);
    const oldClaims = await tokens.verify(loggedIn.body.accessToken as string);
    const newClaims = await tokens.verify(refreshed.body.accessToken as string);
    const ack = await socket.emitWithAck(ClientEvent.RefreshAuth, {
      accessToken: refreshed.body.accessToken as string,
    });

    expect(newClaims.sid).not.toBe(oldClaims.sid);
    expect(ack).toEqual({ ok: true, data: { userId: alice.id } });
    expect(socket.connected).toBe(true);

    const events = harness.app.get<DomainEventBus>(DOMAIN_EVENT_BUS);
    await events.publish("session.revoked", { sessionId: oldClaims.sid, userId: alice.id });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(socket.connected).toBe(true);

    const disconnect = disconnected(socket);
    await events.publish("session.revoked", { sessionId: newClaims.sid, userId: alice.id });
    await expect(disconnect).resolves.toBe("io server disconnect");
  });

  it("disconnects when auth is refreshed with another user's token", async () => {
    const socket = connect(aliceToken);
    await connected(socket);

    const disconnect = disconnected(socket);
    const ack = await socket.emitWithAck(ClientEvent.RefreshAuth, { accessToken: bobToken });

    expect(ack).toEqual({
      ok: false,
      errorCode: "UNAUTHENTICATED",
      message: "Token does not belong to this socket user",
    });
    await expect(disconnect).resolves.toBe("io server disconnect");
    expect(socket.connected).toBe(false);
  });

  it("accepts another live session token belonging to the same user", async () => {
    const otherSessionToken = await login(alice);
    const socket = connect(aliceToken);
    await connected(socket);

    const ack = await socket.emitWithAck(ClientEvent.RefreshAuth, {
      accessToken: otherSessionToken,
    });

    expect(ack).toEqual({ ok: true, data: { userId: alice.id } });
    expect(socket.connected).toBe(true);
  });

  it("disconnects the open socket when its session logs out", async () => {
    const user = await createMember();
    const session = request.agent(harness.app.getHttpServer());
    const loggedIn = await session
      .post("/auth/login")
      .send({ username: user.username, password: user.password })
      .expect(200);
    const socket = connect(loggedIn.body.accessToken as string);
    await connected(socket);

    const disconnect = disconnected(socket);
    await session.post("/auth/logout").expect(204);

    await expect(disconnect).resolves.toBe("io server disconnect");
  });

  it("disconnects only the socket of the individually revoked session", async () => {
    const user = await createMember();
    const keeperToken = await login(user);
    const doomedToken = await login(user);
    const keeperSocket = connect(keeperToken);
    const doomedSocket = connect(doomedToken);
    await Promise.all([connected(keeperSocket), connected(doomedSocket)]);

    const doomedSession = await harness.app.get(AccessTokenService).verify(doomedToken);
    const disconnect = disconnected(doomedSocket);

    await request(harness.app.getHttpServer())
      .delete(`/auth/sessions/${doomedSession.sid}`)
      .set("Authorization", `Bearer ${keeperToken}`)
      .expect(204);

    await expect(disconnect).resolves.toBe("io server disconnect");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(keeperSocket.connected).toBe(true);
  });

  it("disconnects every socket when refresh token reuse is detected", async () => {
    const user = await createMember();
    const firstLogin = await request(harness.app.getHttpServer())
      .post("/auth/login")
      .send({ username: user.username, password: user.password })
      .expect(200);
    const secondToken = await login(user);
    const firstSocket = connect(firstLogin.body.accessToken as string);
    const secondSocket = connect(secondToken);
    await Promise.all([connected(firstSocket), connected(secondSocket)]);

    const stolenCookie = refreshCookieOf(firstLogin);
    await request(harness.app.getHttpServer())
      .post("/auth/refresh")
      .set("Cookie", stolenCookie)
      .expect(200);

    const firstDisconnect = disconnected(firstSocket);
    const secondDisconnect = disconnected(secondSocket);
    await request(harness.app.getHttpServer())
      .post("/auth/refresh")
      .set("Cookie", stolenCookie)
      .expect(401);

    await expect(firstDisconnect).resolves.toBe("io server disconnect");
    await expect(secondDisconnect).resolves.toBe("io server disconnect");
  });

  it("delivers a message from one client to another in the same channel", async () => {
    const aliceSocket = connect(aliceToken);
    const bobSocket = connect(bobToken);

    await Promise.all([connected(aliceSocket), connected(bobSocket)]);

    await aliceSocket.emitWithAck(ClientEvent.Subscribe, { channelId });
    await bobSocket.emitWithAck(ClientEvent.Subscribe, { channelId });

    const incoming = waitFor<MessageView>(bobSocket, ServerEvent.MessageNew);

    const ack = await aliceSocket.emitWithAck(ClientEvent.SendMessage, {
      channelId,
      text: "hello from alice",
      clientNonce: "nonce-1",
    });

    expect(ack.ok).toBe(true);

    const received = await incoming;
    expect(received.text).toBe("hello from alice");
    expect(received.author.id).toBe(alice.id);
    expect(received.clientNonce).toBe("nonce-1");
  });

  it("echoes the sender's nonce back so an optimistic copy can be replaced", async () => {
    const socket = connect(aliceToken);
    await connected(socket);
    await socket.emitWithAck(ClientEvent.Subscribe, { channelId });

    const ack = await socket.emitWithAck(ClientEvent.SendMessage, {
      channelId,
      text: "with nonce",
      clientNonce: "abc-123",
    });

    expect(ack.ok).toBe(true);
    expect(ack.data.message.clientNonce).toBe("abc-123");
  });

  it("relays typing to others but not back to the typist", async () => {
    const aliceSocket = connect(aliceToken);
    const bobSocket = connect(bobToken);
    await Promise.all([connected(aliceSocket), connected(bobSocket)]);
    await aliceSocket.emitWithAck(ClientEvent.Subscribe, { channelId });
    await bobSocket.emitWithAck(ClientEvent.Subscribe, { channelId });

    let echoed = false;
    aliceSocket.once(ServerEvent.Typing, () => {
      echoed = true;
    });

    const seen = waitFor<TypingEvent>(bobSocket, ServerEvent.Typing);
    await aliceSocket.emitWithAck(ClientEvent.TypingStart, { channelId });

    const event = await seen;
    expect(event.userId).toBe(alice.id);
    expect(new Date(event.until).getTime()).toBeGreaterThan(Date.now());
    expect(echoed).toBe(false);
  });

  it("rejects an empty message instead of storing it", async () => {
    const socket = connect(aliceToken);
    await connected(socket);
    await socket.emitWithAck(ClientEvent.Subscribe, { channelId });

    const ack = await socket.emitWithAck(ClientEvent.SendMessage, { channelId, text: "   " });

    expect(ack.ok).toBe(false);
    expect(ack.errorCode).toBe("INVALID_MESSAGE");
  });

  it("refuses to subscribe to a channel the member may not view", async () => {
    const ownerToken = await loginAsOwner();

    const member = await harness.prisma.db.member.findFirstOrThrow({
      where: { serverId: seeded.serverId, userId: bob.id },
    });

    await request(harness.app.getHttpServer())
      .put(`/channels/${channelId}/overrides`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        memberId: member.id,
        allow: "0",
        deny: serializePermissions(Permission.ViewChannel),
      })
      .expect(204);

    const socket = connect(bobToken);
    await connected(socket);

    const ack = await socket.emitWithAck(ClientEvent.Subscribe, { channelId });

    expect(ack.ok).toBe(false);
    expect(ack.errorCode).toBe("NOT_FOUND");

    await request(harness.app.getHttpServer())
      .delete(`/channels/${channelId}/overrides/${member.id}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(204);
  });

  it("removes a subscribed socket after ViewChannel is revoked", async () => {
    const ownerToken = await loginAsOwner();
    const member = await harness.prisma.db.member.findFirstOrThrow({
      where: { serverId: seeded.serverId, userId: bob.id },
    });
    const listener = connect(bobToken);
    const sender = connect(aliceToken);
    await Promise.all([connected(listener), connected(sender)]);
    await listener.emitWithAck(ClientEvent.Subscribe, { channelId });
    await sender.emitWithAck(ClientEvent.Subscribe, { channelId });

    const revoked = waitFor<ChannelAccessRevokedEvent>(listener, ServerEvent.ChannelAccessRevoked);
    await request(harness.app.getHttpServer())
      .put(`/channels/${channelId}/overrides`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        memberId: member.id,
        allow: "0",
        deny: serializePermissions(Permission.ViewChannel),
      })
      .expect(204);

    await expect(revoked).resolves.toEqual({ channelId });

    let delivered = false;
    listener.once(ServerEvent.MessageNew, () => {
      delivered = true;
    });
    await sender.emitWithAck(ClientEvent.SendMessage, {
      channelId,
      text: "not visible after revocation",
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(delivered).toBe(false);

    await request(harness.app.getHttpServer())
      .delete(`/channels/${channelId}/overrides/${member.id}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(204);
  });

  it("rechecks subscribed sockets when member role permissions change", async () => {
    const ownerToken = await loginAsOwner();
    const listener = connect(bobToken);
    const sender = connect(ownerToken);
    await Promise.all([connected(listener), connected(sender)]);
    await listener.emitWithAck(ClientEvent.Subscribe, { channelId });
    await sender.emitWithAck(ClientEvent.Subscribe, { channelId });

    const revoked = waitFor<ChannelAccessRevokedEvent>(listener, ServerEvent.ChannelAccessRevoked);

    try {
      await request(harness.app.getHttpServer())
        .patch(`/roles/${seeded.everyoneRoleId}`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          permissions: serializePermissions(DEFAULT_EVERYONE_PERMISSIONS & ~Permission.ViewChannel),
        })
        .expect(200);

      await expect(revoked).resolves.toEqual({ channelId });

      let delivered = false;
      listener.once(ServerEvent.MessageNew, () => {
        delivered = true;
      });
      await sender.emitWithAck(ClientEvent.SendMessage, {
        channelId,
        text: "not visible after role change",
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(delivered).toBe(false);
    } finally {
      await request(harness.app.getHttpServer())
        .patch(`/roles/${seeded.everyoneRoleId}`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ permissions: serializePermissions(DEFAULT_EVERYONE_PERMISSIONS) })
        .expect(200);
    }
  });

  it("refuses to send when the member may see the channel but not write in it", async () => {
    const ownerToken = await loginAsOwner();

    const member = await harness.prisma.db.member.findFirstOrThrow({
      where: { serverId: seeded.serverId, userId: bob.id },
    });

    await request(harness.app.getHttpServer())
      .put(`/channels/${channelId}/overrides`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        memberId: member.id,
        allow: "0",
        deny: serializePermissions(Permission.SendMessages),
      })
      .expect(204);

    const socket = connect(bobToken);
    await connected(socket);

    const subscribed = await socket.emitWithAck(ClientEvent.Subscribe, { channelId });
    expect(subscribed.ok).toBe(true);

    const ack = await socket.emitWithAck(ClientEvent.SendMessage, {
      channelId,
      text: "should not go through",
    });

    expect(ack.ok).toBe(false);
    expect(ack.errorCode).toBe("MISSING_PERMISSION");

    const stored = await harness.prisma.db.message.count({
      where: { channelId, authorId: bob.id, deletedAt: null },
    });
    expect(stored).toBe(0);

    await request(harness.app.getHttpServer())
      .delete(`/channels/${channelId}/overrides/${member.id}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(204);
  });

  it("does not deliver events to a socket that never subscribed", async () => {
    const listener = connect(bobToken);
    const sender = connect(aliceToken);
    await Promise.all([connected(listener), connected(sender)]);
    await sender.emitWithAck(ClientEvent.Subscribe, { channelId });

    let delivered = false;
    listener.once(ServerEvent.MessageNew, () => {
      delivered = true;
    });

    await sender.emitWithAck(ClientEvent.SendMessage, { channelId, text: "unheard" });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(delivered).toBe(false);
  });

  it("delivers an edit made over HTTP to everyone subscribed to the channel", async () => {
    const author = connect(aliceToken);
    const watcher = connect(bobToken);
    await Promise.all([connected(author), connected(watcher)]);
    await author.emitWithAck(ClientEvent.Subscribe, { channelId });
    await watcher.emitWithAck(ClientEvent.Subscribe, { channelId });

    const sent = await author.emitWithAck(ClientEvent.SendMessage, {
      channelId,
      text: "before the edit",
    });
    const messageId = (sent.data.message as MessageView).id;

    const updated = waitFor<MessageView>(watcher, ServerEvent.MessageUpdated);

    await request(harness.app.getHttpServer())
      .patch(`/messages/${messageId}`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ text: "after the edit" })
      .expect(200);

    const event = await updated;
    expect(event.id).toBe(messageId);
    expect(event.text).toBe("after the edit");
  });

  it("delivers a deletion made over HTTP to everyone subscribed to the channel", async () => {
    const author = connect(aliceToken);
    const watcher = connect(bobToken);
    await Promise.all([connected(author), connected(watcher)]);
    await author.emitWithAck(ClientEvent.Subscribe, { channelId });
    await watcher.emitWithAck(ClientEvent.Subscribe, { channelId });

    const sent = await author.emitWithAck(ClientEvent.SendMessage, {
      channelId,
      text: "doomed",
    });
    const messageId = (sent.data.message as MessageView).id;

    const removed = waitFor<{ channelId: string; messageId: string }>(
      watcher,
      ServerEvent.MessageDeleted,
    );

    await request(harness.app.getHttpServer())
      .delete(`/messages/${messageId}`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .expect(204);

    expect(await removed).toEqual({ channelId, messageId });
  });

  it("refuses a read mark that points at a message from another channel", async () => {
    const ownerToken = await loginAsOwner();
    const other = await request(harness.app.getHttpServer())
      .post(`/servers/${seeded.serverId}/channels`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "elsewhere", type: "TEXT" })
      .expect(201);
    const otherChannelId = other.body.id as string;

    const socket = connect(aliceToken);
    await connected(socket);
    await socket.emitWithAck(ClientEvent.Subscribe, { channelId });
    await socket.emitWithAck(ClientEvent.Subscribe, { channelId: otherChannelId });

    const elsewhere = await socket.emitWithAck(ClientEvent.SendMessage, {
      channelId: otherChannelId,
      text: "not your business",
    });

    const ack = await socket.emitWithAck(ClientEvent.MarkRead, {
      channelId,
      messageId: (elsewhere.data.message as MessageView).id,
    });

    expect(ack.ok).toBe(false);
    expect(ack.errorCode).toBe("MESSAGE_NOT_IN_CHANNEL");

    await request(harness.app.getHttpServer())
      .delete(`/channels/${otherChannelId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(204);
  });

  it("leaves a channel the member may not view out of the unread counters", async () => {
    const ownerToken = await loginAsOwner();
    const member = await harness.prisma.db.member.findFirstOrThrow({
      where: { serverId: seeded.serverId, userId: bob.id },
    });

    const author = connect(aliceToken);
    await connected(author);
    await author.emitWithAck(ClientEvent.Subscribe, { channelId });
    await author.emitWithAck(ClientEvent.SendMessage, { channelId, text: "unread by bob" });

    const before = await request(harness.app.getHttpServer())
      .get(`/servers/${seeded.serverId}/unread`)
      .set("Authorization", `Bearer ${bobToken}`)
      .expect(200);

    expect(before.body.channels.some((entry: { channelId: string }) => entry.channelId === channelId)).toBe(
      true,
    );

    await request(harness.app.getHttpServer())
      .put(`/channels/${channelId}/overrides`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        memberId: member.id,
        allow: "0",
        deny: serializePermissions(Permission.ViewChannel),
      })
      .expect(204);

    const after = await request(harness.app.getHttpServer())
      .get(`/servers/${seeded.serverId}/unread`)
      .set("Authorization", `Bearer ${bobToken}`)
      .expect(200);

    expect(after.body.channels).toEqual([]);

    await request(harness.app.getHttpServer())
      .delete(`/channels/${channelId}/overrides/${member.id}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(204);
  });

  it("refuses to send once the per-user message allowance is exhausted", async () => {
    const socket = connect(aliceToken);
    await connected(socket);
    await socket.emitWithAck(ClientEvent.Subscribe, { channelId });

    // The handler allows 10 per 5s, so the boundary itself is the assertion: "some request
    // was refused" would still hold if the limiter blocked at 9 or at 11.
    const allowance = 10;
    const acks: Ack<MessageView>[] = [];

    for (let attempt = 0; attempt < allowance + 2; attempt += 1) {
      acks.push(
        (await socket.emitWithAck(ClientEvent.SendMessage, {
          channelId,
          text: `spam ${String(attempt)}`,
        })) as Ack<MessageView>,
      );
    }

    expect(acks.map((ack) => ack.ok)).toEqual([
      ...Array.from({ length: allowance }, () => true),
      false,
      false,
    ]);

    expect(acks.slice(allowance).map((ack) => (ack.ok ? "allowed" : ack.errorCode))).toEqual([
      "RATE_LIMITED",
      "RATE_LIMITED",
    ]);
  });
});
