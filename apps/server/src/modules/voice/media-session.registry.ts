import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import type { TransportDirection, VoiceMediaSource } from "@voreli/shared";
import type { types } from "mediasoup";

import type { VoiceRouterHandle } from "../../media/router-registry.service.js";
import { TransportFactory } from "../../media/transport.factory.js";
import { MediaConsumerService } from "./media-consumer.service.js";
import { ProducerAdmissionPolicy } from "./producer-admission.policy.js";
import { TransportRecoveryService } from "./transport-recovery.service.js";
import {
  VoiceInvalidTransportDirectionError,
  VoiceMediaObjectLimitError,
  VoiceMediaObjectNotFoundError,
  VoiceSessionNotFoundError,
} from "./errors/voice-media-errors.js";

interface OwnedTransport {
  readonly direction: TransportDirection;
  readonly transport: types.WebRtcTransport;
}

interface MediaSession {
  readonly channelId: string;
  readonly router: types.Router;
  readonly webRtcServer: types.WebRtcServer;
  readonly transports: Map<string, OwnedTransport>;
  readonly producers: Map<string, types.Producer>;
  readonly pendingProducers: Set<string>;
}

interface RoomProducer {
  readonly channelId: string;
  readonly sessionId: string;
  readonly producer: types.Producer;
}

export interface SessionProducerView {
  readonly producerId: string;
  readonly kind: types.MediaKind;
  readonly source: VoiceMediaSource;
  readonly screenStreamId: string | null;
}

@Injectable()
export class MediaSessionRegistry implements OnModuleDestroy {
  private readonly logger = new Logger(MediaSessionRegistry.name);
  private readonly sessions = new Map<string, MediaSession>();
  private readonly producers = new Map<string, RoomProducer>();
  constructor(
    private readonly transports: TransportFactory,
    private readonly recovery: TransportRecoveryService,
    private readonly producerAdmission: ProducerAdmissionPolicy,
    private readonly consumers: MediaConsumerService,
  ) {}

  register(sessionId: string, channelId: string, handle: VoiceRouterHandle): void {
    if (this.sessions.has(sessionId)) {
      return;
    }

    this.sessions.set(sessionId, {
      channelId,
      router: handle.router,
      webRtcServer: handle.webRtcServer,
      transports: new Map(),
      producers: new Map(),
      pendingProducers: new Set(),
    });
    this.consumers.register(sessionId);
    this.recovery.register(sessionId);
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async createTransport(
    sessionId: string,
    direction: TransportDirection,
  ): Promise<types.WebRtcTransport> {
    const session = this.session(sessionId);

    if (
      session.transports.size >= 2 ||
      [...session.transports.values()].some((entry) => entry.direction === direction)
    ) {
      throw new VoiceMediaObjectLimitError("transport");
    }

    const transport = await this.transports.create(session);
    const owned: OwnedTransport = { direction, transport };
    session.transports.set(transport.id, owned);
    this.logger.log({
      message: "Voice transport created",
      sessionId,
      transportId: transport.id,
      direction,
    });

    transport.observer.once("close", () => {
      this.logger.log({
        message: "Voice transport closed",
        sessionId,
        transportId: transport.id,
        direction,
      });
      this.recovery.clear(sessionId, transport.id);
      session.transports.delete(transport.id);
    });
    this.recovery.observe(sessionId, direction, transport);

    return transport;
  }

  async connectTransport(
    sessionId: string,
    transportId: string,
    dtlsParameters: types.DtlsParameters,
  ): Promise<void> {
    await this.ownedTransport(sessionId, transportId).transport.connect({ dtlsParameters });
  }

  async restartIce(sessionId: string, transportId: string): Promise<types.IceParameters> {
    const transport = this.ownedTransport(sessionId, transportId);
    this.logger.log({
      message: "Voice transport ICE restart requested",
      sessionId,
      transportId,
      direction: transport.direction,
    });
    try {
      const parameters = await transport.transport.restartIce();
      this.logger.log({
        message: "Voice transport ICE restart credentials issued",
        sessionId,
        transportId,
        direction: transport.direction,
      });
      return parameters;
    } catch (error: unknown) {
      this.logger.error({
        message: "Voice transport ICE restart failed",
        sessionId,
        transportId,
        direction: transport.direction,
        error,
      });
      throw error;
    }
  }

  async createProducer(
    sessionId: string,
    transportId: string,
    kind: types.MediaKind,
    rtpParameters: types.RtpParameters,
    paused: boolean,
    source: VoiceMediaSource,
    screenStreamId: string | null,
  ): Promise<types.Producer> {
    const session = this.session(sessionId);
    const transport = this.ownedTransport(sessionId, transportId);

    if (transport.direction !== "send") {
      throw new VoiceInvalidTransportDirectionError();
    }

    const sourceKey = this.producerAdmission.sourceKey(
      session.producers,
      session.pendingProducers,
      kind,
      source,
      screenStreamId,
    );
    session.pendingProducers.add(sourceKey);
    let producer: types.Producer;
    try {
      producer = await transport.transport.produce({
        kind,
        rtpParameters,
        paused,
        appData: { source, screenStreamId },
      });
    } finally {
      session.pendingProducers.delete(sourceKey);
    }
    if (!this.sessions.has(sessionId)) {
      producer.close();
      throw new VoiceSessionNotFoundError();
    }
    session.producers.set(producer.id, producer);
    this.producers.set(producer.id, { channelId: session.channelId, sessionId, producer });

    producer.observer.once("close", () => {
      session.producers.delete(producer.id);
      this.producers.delete(producer.id);
    });

    return producer;
  }

  async createConsumer(
    sessionId: string,
    transportId: string,
    producerId: string,
    rtpCapabilities: types.RtpCapabilities,
  ): Promise<types.Consumer> {
    const session = this.session(sessionId);
    const transport = this.ownedTransport(sessionId, transportId);
    const source = this.producers.get(producerId);
    return this.consumers.create(
      sessionId,
      session.channelId,
      session.router,
      transport.transport,
      transport.direction,
      producerId,
      source?.channelId,
      rtpCapabilities,
    );
  }

  async resumeConsumer(sessionId: string, consumerId: string, deafened: boolean): Promise<void> {
    this.session(sessionId);
    await this.consumers.resume(sessionId, consumerId, deafened);
  }

  closeConsumersForProducers(sessionId: string, producerIds: ReadonlySet<string>): void {
    this.session(sessionId);
    this.consumers.closeForProducers(sessionId, producerIds);
  }

  async setPreferredScreenLayer(
    sessionId: string,
    producerIds: ReadonlySet<string>,
    spatialLayer: 0 | 1 | 2,
  ): Promise<void> {
    this.session(sessionId);
    await this.consumers.setPreferredScreenLayer(sessionId, producerIds, spatialLayer);
  }

  async setScreenConsumersPaused(
    sessionId: string,
    producerIds: ReadonlySet<string>,
    paused: boolean,
  ): Promise<void> {
    this.session(sessionId);
    await this.consumers.setScreenPaused(sessionId, producerIds, paused);
  }

  async setProducerPaused(sessionId: string, paused: boolean): Promise<void> {
    await Promise.all(
      [...this.session(sessionId).producers.values()].map((producer) =>
        producer.appData["source"] === "microphone"
          ? paused
            ? producer.pause()
            : producer.resume()
          : Promise.resolve(),
      ),
    );
  }

  async setConsumersPaused(sessionId: string, paused: boolean): Promise<void> {
    this.session(sessionId);
    await this.consumers.setAudioPaused(sessionId, paused);
  }

  producersOfSession(sessionId: string): readonly SessionProducerView[] {
    return [...this.session(sessionId).producers.values()].map((producer) => ({
      producerId: producer.id,
      kind: producer.kind,
      source: producer.appData["source"] as VoiceMediaSource,
      screenStreamId: (producer.appData["screenStreamId"] as string | null) ?? null,
    }));
  }

  producerOfSession(sessionId: string, producerId: string): SessionProducerView | null {
    const producer = this.session(sessionId).producers.get(producerId);
    return producer ? this.producerView(producer) : null;
  }

  producerSource(producerId: string): VoiceMediaSource | null {
    const producer = this.producers.get(producerId)?.producer;
    return producer ? (producer.appData["source"] as VoiceMediaSource) : null;
  }

  closeProducer(sessionId: string, producerId: string): void {
    const producer = this.session(sessionId).producers.get(producerId);
    if (!producer) throw new VoiceMediaObjectNotFoundError();
    producer.close();
  }

  private producerView(producer: types.Producer): SessionProducerView {
    return {
      producerId: producer.id,
      kind: producer.kind,
      source: producer.appData["source"] as VoiceMediaSource,
      screenStreamId: (producer.appData["screenStreamId"] as string | null) ?? null,
    };
  }

  closeSession(sessionId: string): readonly SessionProducerView[] | null {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    this.sessions.delete(sessionId);
    this.recovery.closeSession(sessionId);
    const producers = [...session.producers.values()].map((producer) => ({
      producerId: producer.id,
      kind: producer.kind,
      source: producer.appData["source"] as VoiceMediaSource,
      screenStreamId: (producer.appData["screenStreamId"] as string | null) ?? null,
    }));

    for (const transport of session.transports.values()) {
      this.recovery.clear(sessionId, transport.transport.id);
      transport.transport.close();
    }

    session.transports.clear();
    session.producers.clear();
    this.consumers.closeSession(sessionId);
    return producers;
  }

  onModuleDestroy(): void {
    for (const sessionId of [...this.sessions.keys()]) {
      this.closeSession(sessionId);
    }
  }

  private session(sessionId: string): MediaSession {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new VoiceSessionNotFoundError();
    }

    return session;
  }

  private ownedTransport(sessionId: string, transportId: string): OwnedTransport {
    const transport = this.session(sessionId).transports.get(transportId);

    if (!transport) {
      throw new VoiceMediaObjectNotFoundError();
    }

    return transport;
  }
}
