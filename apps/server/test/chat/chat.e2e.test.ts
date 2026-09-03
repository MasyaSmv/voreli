import {
  CHAT_NAMESPACE,
  ClientEvent,
  type MessageView,
  Permission,
  serializePermissions,
  ServerEvent,
  type TypingEvent,
} from "@voreli/shared";
import { io, type Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

  afterAll(async () => {
    for (const socket of sockets) {
      socket.disconnect();
    }

    await harness.prisma.db.server.delete({ where: { id: seeded.serverId } });
    await harness.prisma.db.user.deleteMany({
      where: { id: { in: [seeded.ownerId, alice.id, bob.id] } },
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
    const ownerUser = await harness.prisma.db.user.findUniqueOrThrow({
      where: { id: seeded.ownerId },
    });
    const ownerToken = await login({
      id: ownerUser.id,
      username: ownerUser.username,
      password: "correct horse battery",
      memberId: "",
    });

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

  it("refuses to send when the member may see the channel but not write in it", async () => {
    const ownerUser = await harness.prisma.db.user.findUniqueOrThrow({
      where: { id: seeded.ownerId },
    });
    const ownerToken = await login({
      id: ownerUser.id,
      username: ownerUser.username,
      password: "correct horse battery",
      memberId: "",
    });

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
});
