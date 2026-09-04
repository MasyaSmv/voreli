import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import type { types } from "mediasoup";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { validateEnv } from "../../config/env.validation.js";
import { MediaModule } from "../../media/media.module.js";
import { RouterRegistryService } from "../../media/router-registry.service.js";
import {
  VoiceCannotConsumeError,
  VoiceInvalidTransportDirectionError,
  VoiceMediaObjectLimitError,
  VoiceMediaObjectNotFoundError,
} from "./errors/voice-media-errors.js";
import { MediaSessionRegistry } from "./media-session.registry.js";
import { VoiceModule } from "./voice.module.js";

describe("media session ownership", () => {
  let moduleRef: TestingModule;
  let routers: RouterRegistryService;
  let registry: MediaSessionRegistry;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        MediaModule,
        VoiceModule,
      ],
    }).compile();
    await moduleRef.init();
    routers = moduleRef.get(RouterRegistryService);
    registry = moduleRef.get(MediaSessionRegistry);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it("enforces transport direction, ownership and per-session limits", async () => {
    const handle = await routers.acquire("room-one");
    registry.register("session-one", "room-one", handle);
    registry.register("session-two", "room-one", handle);

    const send = await registry.createTransport("session-one", "send");
    const recv = await registry.createTransport("session-one", "recv");

    await expect(registry.createTransport("session-one", "send")).rejects.toBeInstanceOf(
      VoiceMediaObjectLimitError,
    );
    await expect(registry.restartIce("session-two", send.id)).rejects.toBeInstanceOf(
      VoiceMediaObjectNotFoundError,
    );
    await expect(
      registry.createProducer("session-one", recv.id, "audio", rtpParameters(handle.router), false),
    ).rejects.toBeInstanceOf(VoiceInvalidTransportDirectionError);

    registry.closeSession("session-one");
    registry.closeSession("session-two");
    expect(send.closed).toBe(true);
    expect(recv.closed).toBe(true);
    routers.release("room-one");
  });

  it("allows consuming another session in the room, including paused-first handshake", async () => {
    const firstHandle = await routers.acquire("room-two");
    const secondHandle = await routers.acquire("room-two");
    registry.register("producer-session", "room-two", firstHandle);
    registry.register("consumer-session", "room-two", secondHandle);

    const send = await registry.createTransport("producer-session", "send");
    const recv = await registry.createTransport("consumer-session", "recv");
    const producer = await registry.createProducer(
      "producer-session",
      send.id,
      "audio",
      rtpParameters(firstHandle.router),
      false,
    );
    const consumer = await registry.createConsumer(
      "consumer-session",
      recv.id,
      producer.id,
      firstHandle.router.rtpCapabilities,
    );

    expect(consumer.paused).toBe(true);
    await registry.resumeConsumer("consumer-session", consumer.id, false);
    expect(consumer.paused).toBe(false);
    await expect(
      registry.createConsumer(
        "consumer-session",
        recv.id,
        producer.id,
        firstHandle.router.rtpCapabilities,
      ),
    ).rejects.toBeInstanceOf(VoiceMediaObjectLimitError);

    const producerClosedAtConsumer = new Promise<void>((resolve) => {
      consumer.once("producerclose", resolve);
    });
    registry.closeSession("producer-session");
    await producerClosedAtConsumer;
    expect(producer.closed).toBe(true);
    expect(consumer.closed).toBe(true);
    registry.closeSession("consumer-session");
    routers.release("room-two");
    routers.release("room-two");
  });

  it("rejects a valid producer from another Router without revealing ownership", async () => {
    const sourceHandle = await routers.acquire("source-room");
    const targetHandle = await routers.acquire("target-room");
    registry.register("source-session", "source-room", sourceHandle);
    registry.register("target-session", "target-room", targetHandle);

    const send = await registry.createTransport("source-session", "send");
    const recv = await registry.createTransport("target-session", "recv");
    const producer = await registry.createProducer(
      "source-session",
      send.id,
      "audio",
      rtpParameters(sourceHandle.router),
      false,
    );

    await expect(
      registry.createConsumer(
        "target-session",
        recv.id,
        producer.id,
        targetHandle.router.rtpCapabilities,
      ),
    ).rejects.toBeInstanceOf(VoiceCannotConsumeError);

    registry.closeSession("source-session");
    registry.closeSession("target-session");
    routers.release("source-room");
    routers.release("target-room");
  });
});

function rtpParameters(router: types.Router): types.RtpParameters {
  const opus = (router.rtpCapabilities.codecs ?? []).find(
    (codec) => codec.mimeType === "audio/opus",
  );

  if (!opus) {
    throw new Error("Test Router has no Opus codec");
  }

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
    encodings: [{ ssrc: 11_111_111 }],
    rtcp: { cname: "voreli-test" },
  };
}
