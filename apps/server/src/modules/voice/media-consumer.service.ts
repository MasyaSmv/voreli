import { Injectable } from "@nestjs/common";
import type { types } from "mediasoup";

import {
  VoiceCannotConsumeError,
  VoiceInvalidTransportDirectionError,
  VoiceMediaObjectLimitError,
  VoiceMediaObjectNotFoundError,
} from "./errors/voice-media-errors.js";

interface OwnedConsumer {
  readonly consumer: types.Consumer;
  readonly producerId: string;
  clientReady: boolean;
}

@Injectable()
export class MediaConsumerService {
  private readonly consumers = new Map<string, Map<string, OwnedConsumer>>();

  register(sessionId: string): void {
    this.consumers.set(sessionId, new Map());
  }

  async create(
    sessionId: string,
    roomId: string,
    router: types.Router,
    transport: types.WebRtcTransport,
    direction: "send" | "recv",
    producerId: string,
    producerRoomId: string | undefined,
    rtpCapabilities: types.RtpCapabilities,
  ): Promise<types.Consumer> {
    if (direction !== "recv") throw new VoiceInvalidTransportDirectionError();
    if (producerRoomId !== roomId || !router.canConsume({ producerId, rtpCapabilities })) {
      throw new VoiceCannotConsumeError();
    }
    const ownedConsumers = this.consumers.get(sessionId);
    if (!ownedConsumers) throw new VoiceMediaObjectNotFoundError();
    if ([...ownedConsumers.values()].some((owned) => owned.producerId === producerId)) {
      throw new VoiceMediaObjectLimitError("consumer");
    }
    const consumer = await transport.consume({ producerId, rtpCapabilities, paused: true });
    const owned: OwnedConsumer = { consumer, producerId, clientReady: false };
    ownedConsumers.set(consumer.id, owned);
    consumer.observer.once("close", () => ownedConsumers.delete(consumer.id));
    consumer.on("producerclose", () => ownedConsumers.delete(consumer.id));
    return consumer;
  }

  async resume(sessionId: string, consumerId: string, deafened: boolean): Promise<void> {
    const owned = this.owned(sessionId, consumerId);
    owned.clientReady = true;
    if (!deafened) await owned.consumer.resume();
  }

  closeForProducers(sessionId: string, producerIds: ReadonlySet<string>): void {
    for (const owned of this.consumers.get(sessionId)?.values() ?? []) {
      if (producerIds.has(owned.producerId)) owned.consumer.close();
    }
  }

  async setPreferredScreenLayer(
    sessionId: string,
    producerIds: ReadonlySet<string>,
    spatialLayer: 0 | 1 | 2,
  ): Promise<void> {
    await Promise.all(
      [...(this.consumers.get(sessionId)?.values() ?? [])]
        .filter((owned) => producerIds.has(owned.producerId) && owned.consumer.kind === "video")
        .map((owned) => owned.consumer.setPreferredLayers({ spatialLayer })),
    );
  }

  async setScreenPaused(
    sessionId: string,
    producerIds: ReadonlySet<string>,
    paused: boolean,
  ): Promise<void> {
    await Promise.all(
      [...(this.consumers.get(sessionId)?.values() ?? [])]
        .filter(
          (owned) =>
            producerIds.has(owned.producerId) &&
            owned.consumer.kind === "video" &&
            (paused || owned.clientReady),
        )
        .map((owned) => (paused ? owned.consumer.pause() : owned.consumer.resume())),
    );
  }

  async setAudioPaused(sessionId: string, paused: boolean): Promise<void> {
    await Promise.all(
      [...(this.consumers.get(sessionId)?.values() ?? [])]
        .filter((owned) => owned.consumer.kind === "audio" && (paused || owned.clientReady))
        .map((owned) => (paused ? owned.consumer.pause() : owned.consumer.resume())),
    );
  }

  closeSession(sessionId: string): void {
    this.consumers.delete(sessionId);
  }

  private owned(sessionId: string, consumerId: string): OwnedConsumer {
    const consumer = this.consumers.get(sessionId)?.get(consumerId);
    if (!consumer) throw new VoiceMediaObjectNotFoundError();
    return consumer;
  }
}
