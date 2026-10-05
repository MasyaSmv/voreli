import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DirectCallService } from "../../src/modules/calls/direct-call.service.js";
import { VoiceCameraService } from "../../src/modules/voice/voice-camera.service.js";
import { VoiceMediaSessionContextService } from "../../src/modules/voice/voice-media-session-context.service.js";
import {
  CALL_DEADLINE_SCHEDULER,
  type CallDeadlineScheduler,
} from "../../src/modules/calls/call-deadline.scheduler.js";
import { DirectCallStore } from "../../src/modules/calls/direct-call.store.js";
import { RouterRegistryService } from "../../src/media/router-registry.service.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../src/common/events/domain-event-bus.js";
import { MediaSessionRegistry } from "../../src/modules/voice/media-session.registry.js";
import { DirectConversationService } from "../../src/modules/relationships/direct-conversation.service.js";
import { ContactSettingsService } from "../../src/modules/relationships/contact-settings.service.js";
import { VoiceRoomService } from "../../src/modules/voice/voice-room.service.js";
import {
  VOICE_STATE_REPOSITORY,
  type VoiceStateRepository,
} from "../../src/modules/voice/voice-state.repository.js";
import { Factories, type SeededServer, type SeededUser } from "../support/factories.js";
import { createTestApp, type TestApp } from "../support/test-app.js";

describe("direct call lifecycle", () => {
  let testApp: TestApp;
  let factories: Factories;
  let server: SeededServer;
  let caller: SeededUser;
  let callee: SeededUser;
  let third: SeededUser;
  let calls: DirectCallService;
  let conversations: DirectConversationService;
  let voiceRooms: VoiceRoomService;
  let voiceState: VoiceStateRepository;
  let contactSettings: ContactSettingsService;
  let deadlines: CallDeadlineScheduler;
  let callStore: DirectCallStore;
  let routers: RouterRegistryService;
  let media: MediaSessionRegistry;
  let events: DomainEventBus;
  let camera: VoiceCameraService;
  let contexts: VoiceMediaSessionContextService;

  beforeAll(async () => {
    testApp = await createTestApp();
    factories = new Factories(testApp.prisma);
    calls = testApp.app.get(DirectCallService);
    conversations = testApp.app.get(DirectConversationService);
    voiceRooms = testApp.app.get(VoiceRoomService);
    voiceState = testApp.app.get(VOICE_STATE_REPOSITORY);
    contactSettings = testApp.app.get(ContactSettingsService);
    deadlines = testApp.app.get(CALL_DEADLINE_SCHEDULER);
    callStore = testApp.app.get(DirectCallStore);
    routers = testApp.app.get(RouterRegistryService);
    media = testApp.app.get(MediaSessionRegistry);
    events = testApp.app.get(DOMAIN_EVENT_BUS);
    camera = testApp.app.get(VoiceCameraService);
    contexts = testApp.app.get(VoiceMediaSessionContextService);
  });

  beforeEach(async () => {
    await testApp.beginTransaction();
    server = await factories.server();
    caller = await factories.member(server);
    callee = await factories.member(server);
    third = await factories.member(server);
  });

  afterEach(async () => {
    await testApp.rollbackTransaction();
  });

  afterAll(async () => {
    await testApp.close();
  });

  it("keeps start idempotent, accepts on one device and writes one terminal event", async () => {
    const conversation = await conversations.findOrCreate(caller.id, callee.id);
    const started = await calls.start(caller.id, "caller-session", {
      conversationId: conversation.id,
      clientNonce: "nonce-one",
    });
    const retried = await calls.start(caller.id, "caller-session", {
      conversationId: conversation.id,
      clientNonce: "nonce-one",
    });

    expect(retried.id).toBe(started.id);
    await expect(calls.accept(started.id, third.id, "foreign-session")).rejects.toMatchObject({
      errorCode: "CALL_NOT_FOUND",
    });

    const accepted = await calls.accept(started.id, callee.id, "callee-session-a");
    expect(accepted.call.status).toBe("ACTIVE");
    expect(accepted.mediaRoomId).toBe(`direct-call:${started.id}`);
    await expect(calls.accept(started.id, callee.id, "callee-session-b")).rejects.toMatchObject({
      errorCode: "CALL_ALREADY_ANSWERED",
    });
    await expect(calls.accept(started.id, callee.id, "callee-session-a")).resolves.toMatchObject({
      call: { id: started.id, status: "ACTIVE" },
    });

    const ended = await calls.hangup(started.id, callee.id);
    expect(ended.status).toBe("ENDED");
    await expect(calls.hangup(started.id, callee.id)).resolves.toMatchObject({
      id: started.id,
      status: "ENDED",
    });

    const stored = await testApp.prisma.db.directCall.findUniqueOrThrow({
      where: { id: started.id },
      include: { historyMessage: true },
    });
    expect(stored.answeredSessionId).toBe("callee-session-a");
    expect(stored.historyMessage?.contentSchema).toBe("system/call/v1");
    expect(
      JSON.parse(Buffer.from(stored.historyMessage?.content ?? []).toString()) as unknown,
    ).toMatchObject({ callId: started.id, outcome: "completed", actorUserId: callee.id });
    await expect(
      testApp.prisma.db.message.count({
        where: { directConversationId: conversation.id, contentSchema: "system/call/v1" },
      }),
    ).resolves.toBe(1);
  });

  it("enforces busy state across conversations and caller/callee roles", async () => {
    const firstConversation = await conversations.findOrCreate(caller.id, callee.id);
    const secondConversation = await conversations.findOrCreate(callee.id, third.id);
    const started = await calls.start(caller.id, "caller-session", {
      conversationId: firstConversation.id,
      clientNonce: "nonce-busy-one",
    });

    await expect(
      calls.start(third.id, "third-session", {
        conversationId: secondConversation.id,
        clientNonce: "nonce-busy-two",
      }),
    ).rejects.toMatchObject({ errorCode: "CALL_USER_BUSY" });

    await calls.decline(started.id, callee.id);
    await expect(
      calls.start(third.id, "third-session", {
        conversationId: secondConversation.id,
        clientNonce: "nonce-busy-two",
      }),
    ).resolves.toMatchObject({ status: "RINGING" });
  });

  it("allows only the caller to cancel and only the callee to decline", async () => {
    const conversation = await conversations.findOrCreate(caller.id, callee.id);
    const started = await calls.start(caller.id, "caller-session", {
      conversationId: conversation.id,
      clientNonce: "nonce-roles",
    });

    await expect(calls.cancel(started.id, callee.id)).rejects.toMatchObject({
      errorCode: "CALL_NOT_FOUND",
    });
    await expect(calls.decline(started.id, caller.id)).rejects.toMatchObject({
      errorCode: "CALL_NOT_FOUND",
    });
    await expect(calls.cancel(started.id, caller.id)).resolves.toMatchObject({
      status: "CANCELLED",
    });
  });

  it("authorizes exactly the two call participants in the shared media room", async () => {
    const conversation = await conversations.findOrCreate(caller.id, callee.id);
    const started = await calls.start(caller.id, "caller-session", {
      conversationId: conversation.id,
      clientNonce: "nonce-media",
    });
    const accepted = await calls.accept(started.id, callee.id, "callee-session");

    await voiceRooms.join(caller.id, "caller-session", "caller-socket", accepted.mediaRoomId);
    await voiceRooms.join(callee.id, "callee-session", "callee-socket", accepted.mediaRoomId);
    await expect(
      voiceRooms.join(
        callee.id,
        "callee-other-session",
        "callee-other-socket",
        accepted.mediaRoomId,
      ),
    ).rejects.toMatchObject({ errorCode: "VOICE_CONNECT_FORBIDDEN" });
    await voiceRooms.leaveAuthenticatedSession(callee.id, "callee-other-session");
    await expect(voiceState.participant(accepted.mediaRoomId, callee.id)).resolves.toMatchObject({
      authenticationSessionId: "callee-session",
    });
    await expect(
      voiceRooms.join(third.id, "third-session", "third-socket", accepted.mediaRoomId),
    ).rejects.toMatchObject({ errorCode: "VOICE_CONNECT_FORBIDDEN" });
    await expect(voiceState.participants(accepted.mediaRoomId)).resolves.toHaveLength(2);

    await calls.hangup(started.id, caller.id);
    await expectEventually(async () => {
      expect(await voiceState.participants(accepted.mediaRoomId)).toHaveLength(0);
      expect(routers.participantCount(accepted.mediaRoomId)).toBe(0);
    });
  });

  it("publishes one camera per call participant and restricts stopping it to its owner", async () => {
    const conversation = await conversations.findOrCreate(caller.id, callee.id);
    const started = await calls.start(caller.id, "caller-camera-session", {
      conversationId: conversation.id,
      clientNonce: "nonce-camera",
    });
    const accepted = await calls.accept(started.id, callee.id, "callee-camera-session");
    const callerJoin = await voiceRooms.join(
      caller.id,
      "caller-camera-session",
      "caller-camera-socket",
      accepted.mediaRoomId,
    );
    const calleeJoin = await voiceRooms.join(
      callee.id,
      "callee-camera-session",
      "callee-camera-socket",
      accepted.mediaRoomId,
    );
    const callerSend = await media.createTransport(callerJoin.sessionId, "send");
    const calleeRecv = await media.createTransport(calleeJoin.sessionId, "recv");
    const callerContext = await contexts.resolve(caller.id, "caller-camera-session");
    const calleeContext = await contexts.resolve(callee.id, "callee-camera-session");
    const vp8 = callerJoin.rtpCapabilities.codecs?.find(
      (codec) => codec.mimeType.toLowerCase() === "video/vp8",
    );
    if (!vp8) throw new Error("Voice Router has no VP8 codec");
    const command = {
      transportId: callerSend.id,
      source: "camera-video" as const,
      kind: "video" as const,
      rtpParameters: {
        mid: "camera-video",
        codecs: [
          {
            mimeType: vp8.mimeType,
            payloadType: vp8.preferredPayloadType,
            clockRate: vp8.clockRate,
            parameters: vp8.parameters ?? {},
            rtcpFeedback: vp8.rtcpFeedback ?? [],
          },
        ],
        headerExtensions: [],
        encodings: [{ ssrc: 55_555_555 }],
        rtcp: { cname: "voreli-camera-e2e" },
      },
    };
    const producer = await camera.create(
      caller.id,
      "caller-camera-session",
      callerContext,
      command,
    );
    await expect(
      camera.create(caller.id, "caller-camera-session", callerContext, command),
    ).rejects.toMatchObject({ errorCode: "VOICE_MEDIA_OBJECT_LIMIT" });
    const consumer = await media.createConsumer(
      calleeJoin.sessionId,
      calleeRecv.id,
      producer.id,
      calleeJoin.rtpCapabilities,
    );
    expect(consumer.kind).toBe("video");
    await expect(
      camera.stop(callee.id, "callee-camera-session", calleeContext, {
        mediaRoomId: accepted.mediaRoomId,
        producerId: producer.id,
      }),
    ).rejects.toMatchObject({ errorCode: "VOICE_MEDIA_OBJECT_NOT_FOUND" });
    await camera.stop(caller.id, "caller-camera-session", callerContext, {
      mediaRoomId: accepted.mediaRoomId,
      producerId: producer.id,
    });
    expect(producer.closed).toBe(true);
    await expectEventually(() => expect(consumer.closed).toBe(true));
    await camera.stop(caller.id, "caller-camera-session", callerContext, {
      mediaRoomId: accepted.mediaRoomId,
      producerId: producer.id,
    });
    const restarted = await camera.create(caller.id, "caller-camera-session", callerContext, {
      ...command,
      rtpParameters: {
        ...command.rtpParameters,
        encodings: [{ ssrc: 66_666_666 }],
      },
    });
    const restartedConsumer = await media.createConsumer(
      calleeJoin.sessionId,
      calleeRecv.id,
      restarted.id,
      calleeJoin.rtpCapabilities,
    );
    await calls.hangup(started.id, caller.id);
    await expectEventually(() => {
      expect(restarted.closed).toBe(true);
      expect(restartedConsumer.closed).toBe(true);
    });
  });

  it("keeps the ring deadline after an invalid hangup and expires exactly once", async () => {
    const conversation = await conversations.findOrCreate(caller.id, callee.id);
    const started = await calls.start(caller.id, "caller-session-timeout", {
      conversationId: conversation.id,
      clientNonce: "nonce-timeout",
    });

    await expect(calls.hangup(started.id, caller.id)).rejects.toMatchObject({
      errorCode: "CALL_INVALID_STATE",
    });
    expect(deadlines.has(started.id)).toBe(true);
    deadlines.schedule(started.id, 1);

    await expectEventually(async () => {
      await expect(callStore.byId(started.id)).resolves.toMatchObject({ status: "MISSED" });
    });
    await expect(
      testApp.prisma.db.message.count({
        where: { directConversationId: conversation.id, contentSchema: "system/call/v1" },
      }),
    ).resolves.toBe(1);
  });

  it("reconciles a lost ring timer and an orphaned terminal media room", async () => {
    const conversation = await conversations.findOrCreate(caller.id, callee.id);
    const ringing = await calls.start(caller.id, "caller-session-reconcile", {
      conversationId: conversation.id,
      clientNonce: "nonce-reconcile-ring",
    });
    deadlines.cancel(ringing.id);
    await testApp.prisma.db.directCall.update({
      where: { id: ringing.id },
      data: { createdAt: new Date(Date.now() - 31_000) },
    });

    await Promise.all([calls.reconcileNow(), calls.reconcileNow()]);
    await expect(callStore.byId(ringing.id)).resolves.toMatchObject({ status: "MISSED" });
    await expect(
      testApp.prisma.db.message.count({
        where: { directConversationId: conversation.id, contentSchema: "system/call/v1" },
      }),
    ).resolves.toBe(1);

    const next = await calls.start(caller.id, "caller-session-orphan", {
      conversationId: conversation.id,
      clientNonce: "nonce-reconcile-orphan",
    });
    const accepted = await calls.accept(next.id, callee.id, "callee-session-orphan");
    await voiceRooms.join(
      caller.id,
      "caller-session-orphan",
      "caller-socket-orphan",
      accepted.mediaRoomId,
    );
    expect(routers.participantCount(accepted.mediaRoomId)).toBe(1);
    await callStore.terminal(next.id, caller.id, "ACTIVE", "ENDED");

    await calls.reconcileNow();
    await expectEventually(async () => {
      expect(await voiceState.participants(accepted.mediaRoomId)).toHaveLength(0);
      expect(routers.participantCount(accepted.mediaRoomId)).toBe(0);
    });
  });

  it("publishes transport-only reconnect state without dropping the socket", async () => {
    const conversation = await conversations.findOrCreate(caller.id, callee.id);
    const started = await calls.start(caller.id, "caller-session-ice", {
      conversationId: conversation.id,
      clientNonce: "nonce-ice-reconnect",
    });
    const accepted = await calls.accept(started.id, callee.id, "callee-session-ice");
    const joined = await voiceRooms.join(
      caller.id,
      "caller-session-ice",
      "caller-socket-ice",
      accepted.mediaRoomId,
    );
    const reconnecting: boolean[] = [];
    const unsubscribe = events.subscribe("media.participant.reconnecting", (event) => {
      if (event.mediaRoomId === accepted.mediaRoomId && event.userId === caller.id) {
        reconnecting.push(event.reconnecting);
      }
    });
    const transport = await media.createTransport(joined.sessionId, "send");

    transport.safeEmit("icestatechange", "disconnected");
    await expectEventually(() => expect(reconnecting).toContain(true));
    transport.safeEmit("icestatechange", "connected");
    await expectEventually(() => expect(reconnecting).toEqual([true, false]));

    unsubscribe();
    await calls.hangup(started.id, caller.id);
  });

  it("ends an active call when the callee revokes call permission", async () => {
    const conversation = await conversations.findOrCreate(caller.id, callee.id);
    const started = await calls.start(caller.id, "caller-session", {
      conversationId: conversation.id,
      clientNonce: "nonce-policy",
    });
    await calls.accept(started.id, callee.id, "callee-session");

    await contactSettings.update(callee.id, { directCallAudience: "NOBODY" });
    await expectEventually(async () => {
      await expect(
        testApp.prisma.db.directCall.findUniqueOrThrow({ where: { id: started.id } }),
      ).resolves.toMatchObject({ status: "ENDED" });
    });
  });
});

async function expectEventually(assertion: () => Promise<void> | void): Promise<void> {
  const deadline = Date.now() + 2_000;
  let latest: unknown;

  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error: unknown) {
      latest = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  throw latest;
}
