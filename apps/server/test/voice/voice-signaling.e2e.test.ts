import { createId } from "@paralleldrive/cuid2";
import {
  type Ack,
  type CreateConsumerResponse,
  type CreateProducerPayload,
  type CreateProducerResponse,
  type CreateTransportResponse,
  Permission,
  serializePermissions,
  VOICE_NAMESPACE,
  VoiceClientEvent,
  VoiceServerEvent,
  type VoiceParticipantJoinedEvent,
  type VoiceProducerEvent,
  type VoiceJoinResponse,
} from "@voreli/shared";
import { io, type Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { VoiceRoomService } from "../../src/modules/voice/voice-room.service.js";
import { Factories, type SeededServer, type SeededUser } from "../support/factories.js";
import { createTestApp, type TestApp } from "../support/test-app.js";

describe("voice signaling", () => {
  let harness: TestApp;
  let server: SeededServer;
  let alice: SeededUser;
  let bob: SeededUser;
  let channelId: string;
  let ownerToken: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    harness = await createTestApp();
    const factories = new Factories(harness.prisma);
    server = await factories.server();
    alice = await factories.member(server);
    bob = await factories.member(server);
    channelId = createId();
    await harness.prisma.db.channel.create({
      data: { id: channelId, serverId: server.serverId, name: "Voice", type: "VOICE" },
    });
    await harness.listen();
    await harness.resetRateLimits();

    const owner = await harness.prisma.db.user.findUniqueOrThrow({ where: { id: server.ownerId } });
    ownerToken = await login({
      id: owner.id,
      username: owner.username,
      password: "correct horse battery",
      memberId: "",
    });
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    const rooms = harness.app.get(VoiceRoomService);
    await rooms.leaveUser(alice.id);
    await rooms.leaveUser(bob.id);
    await harness.prisma.db.server.delete({ where: { id: server.serverId } });
    await harness.prisma.db.user.deleteMany({
      where: { id: { in: [server.ownerId, alice.id, bob.id] } },
    });
    await harness.close();
  });

  it("routes a producer through owned transports and enforces Speak", async () => {
    await request(harness.app.getHttpServer())
      .put(`/channels/${channelId}/overrides`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        memberId: bob.memberId,
        allow: "0",
        deny: serializePermissions(Permission.Speak),
      })
      .expect(204);

    const aliceSocket = await connect(await login(alice));
    const bobSocket = await connect(await login(bob));
    const aliceJoin = ok<VoiceJoinResponse>(
      await aliceSocket.emitWithAck(VoiceClientEvent.Join, { channelId }),
    );
    const joinedEvent = waitFor<VoiceParticipantJoinedEvent>(
      aliceSocket,
      VoiceServerEvent.ParticipantJoined,
    );
    const bobJoin = ok<VoiceJoinResponse>(
      await bobSocket.emitWithAck(VoiceClientEvent.Join, { channelId }),
    );

    await expect(joinedEvent).resolves.toMatchObject({ participant: { userId: bob.id } });
    expect(aliceJoin.participants).toHaveLength(1);
    expect(bobJoin.participants).toHaveLength(2);

    const aliceSend = ok<CreateTransportResponse>(
      await aliceSocket.emitWithAck(VoiceClientEvent.CreateTransport, { direction: "send" }),
    );
    const bobSend = ok<CreateTransportResponse>(
      await bobSocket.emitWithAck(VoiceClientEvent.CreateTransport, { direction: "send" }),
    );
    const bobRecv = ok<CreateTransportResponse>(
      await bobSocket.emitWithAck(VoiceClientEvent.CreateTransport, { direction: "recv" }),
    );

    const forbidden = (await bobSocket.emitWithAck(VoiceClientEvent.CreateProducer, {
      transportId: bobSend.id,
      kind: "audio",
      rtpParameters: rtpParameters(bobJoin.rtpCapabilities),
    })) as Ack<unknown>;
    expect(forbidden).toMatchObject({ ok: false, errorCode: "VOICE_SPEAK_FORBIDDEN" });

    const producerEvent = waitFor<VoiceProducerEvent>(bobSocket, VoiceServerEvent.ProducerNew);
    const produced = ok<CreateProducerResponse>(
      await aliceSocket.emitWithAck(VoiceClientEvent.CreateProducer, {
        transportId: aliceSend.id,
        kind: "audio",
        rtpParameters: rtpParameters(aliceJoin.rtpCapabilities),
      }),
    );
    await expect(producerEvent).resolves.toMatchObject({
      userId: alice.id,
      producerId: produced.producerId,
    });

    const wrongDirection = (await bobSocket.emitWithAck(VoiceClientEvent.CreateConsumer, {
      transportId: bobSend.id,
      producerId: produced.producerId,
      rtpCapabilities: bobJoin.rtpCapabilities,
    })) as Ack<unknown>;
    expect(wrongDirection).toMatchObject({
      ok: false,
      errorCode: "VOICE_INVALID_TRANSPORT_DIRECTION",
    });

    const consumed = ok<CreateConsumerResponse>(
      await bobSocket.emitWithAck(VoiceClientEvent.CreateConsumer, {
        transportId: bobRecv.id,
        producerId: produced.producerId,
        rtpCapabilities: bobJoin.rtpCapabilities,
      }),
    );
    expect(consumed).toMatchObject({ producerId: produced.producerId, kind: "audio" });
    expect(
      await bobSocket.emitWithAck(VoiceClientEvent.ResumeConsumer, {
        consumerId: consumed.consumerId,
      }),
    ).toEqual({ ok: true, data: null });

    const producerClosed = waitFor<{ producerId: string }>(
      bobSocket,
      VoiceServerEvent.ProducerClosed,
    );
    await request(harness.app.getHttpServer())
      .put(`/channels/${channelId}/overrides`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        memberId: alice.memberId,
        allow: "0",
        deny: serializePermissions(Permission.Speak),
      })
      .expect(204);
    await expect(producerClosed).resolves.toEqual({ producerId: produced.producerId });

    const participantLeft = waitFor<{ userId: string }>(
      bobSocket,
      VoiceServerEvent.ParticipantLeft,
    );
    await request(harness.app.getHttpServer())
      .put(`/channels/${channelId}/overrides`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        memberId: alice.memberId,
        allow: "0",
        deny: serializePermissions(Permission.Speak | Permission.Connect),
      })
      .expect(204);
    await expect(participantLeft).resolves.toEqual({ userId: alice.id });
  });

  async function login(user: SeededUser): Promise<string> {
    const response = await request(harness.app.getHttpServer())
      .post("/auth/login")
      .send({ username: user.username, password: user.password })
      .expect(200);
    return response.body.accessToken as string;
  }

  async function connect(token: string): Promise<Socket> {
    const socket = io(`http://127.0.0.1:${String(harness.port())}${VOICE_NAMESPACE}`, {
      transports: ["websocket"],
      auth: { token },
      forceNew: true,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    return socket;
  }
});

function ok<T>(acknowledgement: unknown): T {
  const ack = acknowledgement as Ack<T>;
  if (!ack.ok) throw new Error(`${ack.errorCode}: ${ack.message}`);
  return ack.data;
}

function waitFor<T>(socket: Socket, event: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 4_000);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function rtpParameters(
  capabilities: VoiceJoinResponse["rtpCapabilities"],
): CreateProducerPayload["rtpParameters"] {
  const opus = capabilities.codecs?.find((codec) => codec.mimeType === "audio/opus");
  if (!opus) throw new Error("Voice Router has no Opus codec");

  return {
    mid: "audio",
    codecs: [
      {
        mimeType: opus.mimeType,
        payloadType: opus.preferredPayloadType,
        clockRate: opus.clockRate,
        channels: opus.channels ?? 2,
        parameters: opus.parameters ?? {},
        rtcpFeedback: opus.rtcpFeedback ?? [],
      },
    ],
    headerExtensions: [],
    encodings: [{ ssrc: 22_222_222 }],
    rtcp: { cname: "voreli-voice-e2e" },
  };
}
