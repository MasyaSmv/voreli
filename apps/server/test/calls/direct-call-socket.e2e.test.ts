import {
  type Ack,
  type AcceptCallResponse,
  CALL_NAMESPACE,
  CallClientEvent,
  type CallAnsweredEvent,
  type CallConnectionQualityEvent,
  type CallEvent,
  CallServerEvent,
  type StartCallResponse,
  type SyncCallResponse,
  VOICE_NAMESPACE,
  VoiceClientEvent,
  type VoiceJoinResponse,
} from "@voreli/shared";
import { io, type Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Factories, type SeededServer, type SeededUser } from "../support/factories.js";
import { createTestApp, type TestApp } from "../support/test-app.js";

describe("direct call socket signaling", () => {
  let harness: TestApp;
  let server: SeededServer;
  let alice: SeededUser;
  let bob: SeededUser;
  let conversationId: string;
  let aliceToken: string;
  let bobFirstToken: string;
  let bobSecondToken: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    harness = await createTestApp();
    const factories = new Factories(harness.prisma);
    server = await factories.server();
    alice = await factories.member(server);
    bob = await factories.member(server);
    await harness.listen();
    await harness.resetRateLimits();
    aliceToken = await login(alice);
    bobFirstToken = await login(bob);
    bobSecondToken = await login(bob);
    const conversation = await request(harness.app.getHttpServer())
      .post("/direct-conversations")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ username: bob.username })
      .expect(201);
    conversationId = conversation.body.id as string;
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    await harness.prisma.db.directConversation.delete({ where: { id: conversationId } });
    await harness.prisma.db.server.delete({ where: { id: server.serverId } });
    await harness.prisma.db.user.deleteMany({
      where: { id: { in: [server.ownerId, alice.id, bob.id] } },
    });
    await harness.close();
  });

  it("acknowledges a payload with the wrong runtime type", async () => {
    const socket = connect(aliceToken, CALL_NAMESPACE);
    await connected(socket);

    await expect(
      socket.emitWithAck(CallClientEvent.Start, {
        conversationId: 42,
        clientNonce: "invalid-call",
      }),
    ).resolves.toMatchObject({ ok: false, errorCode: "INVALID_PAYLOAD" });
  });

  it("rings every callee session and lets exactly one device accept", async () => {
    const aliceSocket = connect(aliceToken, CALL_NAMESPACE);
    const bobFirstSocket = connect(bobFirstToken, CALL_NAMESPACE);
    const bobSecondSocket = connect(bobSecondToken, CALL_NAMESPACE);
    await Promise.all([
      connected(aliceSocket),
      connected(bobFirstSocket),
      connected(bobSecondSocket),
    ]);

    const firstIncoming = waitFor<CallEvent>(bobFirstSocket, CallServerEvent.Incoming);
    const secondIncoming = waitFor<CallEvent>(bobSecondSocket, CallServerEvent.Incoming);
    const callerRinging = waitFor<CallEvent>(aliceSocket, CallServerEvent.Ringing);
    const started: Ack<StartCallResponse> = await aliceSocket.emitWithAck(CallClientEvent.Start, {
      conversationId,
      clientNonce: "socket-call-nonce",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error("Expected call:start to succeed");
    await expect(firstIncoming).resolves.toMatchObject({ call: { id: started.data.call.id } });
    await expect(secondIncoming).resolves.toMatchObject({ call: { id: started.data.call.id } });
    await expect(callerRinging).resolves.toMatchObject({ call: { id: started.data.call.id } });

    const firstAnswered = waitFor<CallAnsweredEvent>(bobFirstSocket, CallServerEvent.Answered);
    const secondAnswered = waitFor<CallAnsweredEvent>(bobSecondSocket, CallServerEvent.Answered);
    const callerAnswered = waitFor<CallAnsweredEvent>(aliceSocket, CallServerEvent.Answered);
    const [firstAccept, secondAccept] = await Promise.all([
      bobFirstSocket.emitWithAck(CallClientEvent.Accept, {
        callId: started.data.call.id,
      }) as Promise<Ack<AcceptCallResponse>>,
      bobSecondSocket.emitWithAck(CallClientEvent.Accept, {
        callId: started.data.call.id,
      }) as Promise<Ack<AcceptCallResponse>>,
    ]);
    expect([firstAccept.ok, secondAccept.ok].filter(Boolean)).toHaveLength(1);
    const firstEvent = await firstAnswered;
    const secondEvent = await secondAnswered;
    expect([firstEvent.answeredByCurrentDevice, secondEvent.answeredByCurrentDevice]).toEqual([
      firstAccept.ok,
      secondAccept.ok,
    ]);
    expect(firstEvent.mediaRoomId).toBe(
      firstAccept.ok ? `direct-call:${started.data.call.id}` : null,
    );
    expect(secondEvent.mediaRoomId).toBe(
      secondAccept.ok ? `direct-call:${started.data.call.id}` : null,
    );
    await expect(callerAnswered).resolves.toMatchObject({
      answeredByCurrentDevice: true,
      mediaRoomId: `direct-call:${started.data.call.id}`,
    });

    const losingSocket = firstAccept.ok ? bobSecondSocket : bobFirstSocket;
    const refused: Ack<AcceptCallResponse> = await losingSocket.emitWithAck(
      CallClientEvent.Accept,
      { callId: started.data.call.id },
    );
    expect(refused).toMatchObject({ ok: false, errorCode: "CALL_ALREADY_ANSWERED" });
    const winnerCallSocket = firstAccept.ok ? bobFirstSocket : bobSecondSocket;
    const winnerSync = (await winnerCallSocket.emitWithAck(
      CallClientEvent.Sync,
      {},
    )) as Ack<SyncCallResponse>;
    const loserSync = (await losingSocket.emitWithAck(
      CallClientEvent.Sync,
      {},
    )) as Ack<SyncCallResponse>;
    expect(winnerSync).toMatchObject({
      ok: true,
      data: {
        call: { id: started.data.call.id },
        mediaRoomId: `direct-call:${started.data.call.id}`,
      },
    });
    expect(loserSync).toEqual({ ok: true, data: { call: null, mediaRoomId: null } });

    const qualityForAlice = waitFor<CallConnectionQualityEvent>(
      aliceSocket,
      CallServerEvent.ConnectionQuality,
    );
    let bobQualityEvents = 0;
    const countBobQualityEvent = (): void => {
      bobQualityEvents += 1;
    };
    bobFirstSocket.on(CallServerEvent.ConnectionQuality, countBobQualityEvent);
    bobSecondSocket.on(CallServerEvent.ConnectionQuality, countBobQualityEvent);
    await expect(
      winnerCallSocket.emitWithAck(CallClientEvent.ReportQuality, {
        callId: started.data.call.id,
        quality: "poor",
      }),
    ).resolves.toEqual({ ok: true, data: null });
    await expect(qualityForAlice).resolves.toEqual({
      callId: started.data.call.id,
      quality: "poor",
    });
    expect(bobQualityEvents).toBe(0);
    bobFirstSocket.off(CallServerEvent.ConnectionQuality, countBobQualityEvent);
    bobSecondSocket.off(CallServerEvent.ConnectionQuality, countBobQualityEvent);

    const bobFirstVoice = connect(bobFirstToken, VOICE_NAMESPACE);
    const bobSecondVoice = connect(bobSecondToken, VOICE_NAMESPACE);
    await Promise.all([connected(bobFirstVoice), connected(bobSecondVoice)]);
    const winningVoice = firstAccept.ok ? bobFirstVoice : bobSecondVoice;
    const losingVoice = firstAccept.ok ? bobSecondVoice : bobFirstVoice;
    const mediaRoomId = `direct-call:${started.data.call.id}`;
    const winnerJoined = (await winningVoice.emitWithAck(VoiceClientEvent.Join, {
      mediaRoomId,
    })) as Ack<VoiceJoinResponse>;
    expect(winnerJoined.ok).toBe(true);
    await expect(
      losingVoice.emitWithAck(VoiceClientEvent.Join, { mediaRoomId }),
    ).resolves.toMatchObject({ ok: false, errorCode: "VOICE_CONNECT_FORBIDDEN" });
    await expect(losingVoice.emitWithAck(VoiceClientEvent.Leave, {})).resolves.toEqual({
      ok: true,
      data: null,
    });
    await expect(
      winningVoice.emitWithAck(VoiceClientEvent.CreateTransport, { direction: "send" }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      losingVoice.emitWithAck(VoiceClientEvent.CreateTransport, { direction: "send" }),
    ).resolves.toMatchObject({ ok: false, errorCode: "VOICE_SESSION_NOT_FOUND" });

    const endedForAlice = waitFor<CallEvent>(aliceSocket, CallServerEvent.Ended);
    const endedForBob = waitFor<CallEvent>(bobFirstSocket, CallServerEvent.Ended);
    const ended: Ack<StartCallResponse> = await aliceSocket.emitWithAck(CallClientEvent.Hangup, {
      callId: started.data.call.id,
    });
    expect(ended.ok).toBe(true);
    await expect(endedForAlice).resolves.toMatchObject({ call: { status: "ENDED" } });
    await expect(endedForBob).resolves.toMatchObject({ call: { status: "ENDED" } });
  });

  async function login(user: SeededUser): Promise<string> {
    const response = await request(harness.app.getHttpServer())
      .post("/auth/login")
      .send({ username: user.username, password: user.password })
      .expect(200);
    return response.body.accessToken as string;
  }

  function connect(token: string, namespace: string): Socket {
    const socket = io(`http://127.0.0.1:${String(harness.port())}${namespace}`, {
      transports: ["websocket"],
      auth: { token },
      forceNew: true,
    });
    sockets.push(socket);
    return socket;
  }
});

function connected(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

function waitFor<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 4_000);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}
