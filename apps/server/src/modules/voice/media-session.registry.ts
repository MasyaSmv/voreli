import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import type { TransportDirection } from "@voreli/shared";
import type { types } from "mediasoup";

import type { VoiceRouterHandle } from "../../media/router-registry.service.js";
import { TransportFactory } from "../../media/transport.factory.js";
import {
  VoiceCannotConsumeError,
  VoiceInvalidTransportDirectionError,
  VoiceMediaObjectLimitError,
  VoiceMediaObjectNotFoundError,
  VoiceSessionNotFoundError,
} from "./errors/voice-media-errors.js";

interface OwnedTransport {
  readonly direction: TransportDirection;
  readonly transport: types.WebRtcTransport;
}

interface OwnedConsumer {
  readonly consumer: types.Consumer;
  readonly producerId: string;
  clientReady: boolean;
}

interface MediaSession {
  readonly channelId: string;
  readonly router: types.Router;
  readonly webRtcServer: types.WebRtcServer;
  readonly transports: Map<string, OwnedTransport>;
  readonly producers: Map<string, types.Producer>;
  readonly consumers: Map<string, OwnedConsumer>;
}

interface RoomProducer {
  readonly channelId: string;
  readonly sessionId: string;
  readonly producer: types.Producer;
}

export interface SessionProducerView {
  readonly producerId: string;
  readonly kind: types.MediaKind;
}

type TransportFailureHandler = (sessionId: string) => Promise<void> | void;

@Injectable()
export class MediaSessionRegistry implements OnModuleDestroy {
  private readonly logger = new Logger(MediaSessionRegistry.name);
  private readonly sessions = new Map<string, MediaSession>();
  private readonly producers = new Map<string, RoomProducer>();
  private readonly failureHandlers = new Set<TransportFailureHandler>();
  private readonly failedSessions = new Set<string>();

  constructor(private readonly transports: TransportFactory) {}

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
      consumers: new Map(),
    });
    this.failedSessions.delete(sessionId);
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  onTransportFailure(handler: TransportFailureHandler): () => void {
    this.failureHandlers.add(handler);
    return () => this.failureHandlers.delete(handler);
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

    transport.observer.once("close", () => session.transports.delete(transport.id));
    transport.on("dtlsstatechange", (state) => {
      if (state === "closed" || state === "failed") {
        this.transportFailed(sessionId, transport);
      }
    });
    transport.on("icestatechange", (state) => {
      if (state === "closed" || state === "disconnected") {
        this.transportFailed(sessionId, transport);
      }
    });

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
    return transport.transport.restartIce();
  }

  async createProducer(
    sessionId: string,
    transportId: string,
    kind: types.MediaKind,
    rtpParameters: types.RtpParameters,
    paused: boolean,
  ): Promise<types.Producer> {
    const session = this.session(sessionId);
    const transport = this.ownedTransport(sessionId, transportId);

    if (transport.direction !== "send") {
      throw new VoiceInvalidTransportDirectionError();
    }

    if (session.producers.size >= 1 || kind !== "audio") {
      throw new VoiceMediaObjectLimitError("producer");
    }

    const producer = await transport.transport.produce({ kind, rtpParameters, paused });
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

    if (transport.direction !== "recv") {
      throw new VoiceInvalidTransportDirectionError();
    }

    if (
      !source ||
      source.channelId !== session.channelId ||
      !session.router.canConsume({ producerId, rtpCapabilities })
    ) {
      throw new VoiceCannotConsumeError();
    }

    if ([...session.consumers.values()].some((owned) => owned.producerId === producerId)) {
      throw new VoiceMediaObjectLimitError("consumer");
    }

    const consumer = await transport.transport.consume({
      producerId,
      rtpCapabilities,
      paused: true,
    });
    const owned: OwnedConsumer = { consumer, producerId, clientReady: false };
    session.consumers.set(consumer.id, owned);
    consumer.observer.once("close", () => session.consumers.delete(consumer.id));
    consumer.on("producerclose", () => session.consumers.delete(consumer.id));
    return consumer;
  }

  async resumeConsumer(sessionId: string, consumerId: string, deafened: boolean): Promise<void> {
    const owned = this.ownedConsumer(sessionId, consumerId);
    owned.clientReady = true;

    if (!deafened) {
      await owned.consumer.resume();
    }
  }

  async setProducerPaused(sessionId: string, paused: boolean): Promise<void> {
    await Promise.all(
      [...this.session(sessionId).producers.values()].map((producer) =>
        paused ? producer.pause() : producer.resume(),
      ),
    );
  }

  async setConsumersPaused(sessionId: string, paused: boolean): Promise<void> {
    await Promise.all(
      [...this.session(sessionId).consumers.values()]
        .filter((owned) => paused || owned.clientReady)
        .map((owned) => (paused ? owned.consumer.pause() : owned.consumer.resume())),
    );
  }

  producersOfSession(sessionId: string): readonly SessionProducerView[] {
    return [...this.session(sessionId).producers.values()].map((producer) => ({
      producerId: producer.id,
      kind: producer.kind,
    }));
  }

  closeProducer(sessionId: string, producerId: string): void {
    const producer = this.session(sessionId).producers.get(producerId);
    if (!producer) throw new VoiceMediaObjectNotFoundError();
    producer.close();
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return;
    }

    this.sessions.delete(sessionId);

    for (const transport of session.transports.values()) {
      transport.transport.close();
    }

    session.transports.clear();
    session.producers.clear();
    session.consumers.clear();
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

  private ownedConsumer(sessionId: string, consumerId: string): OwnedConsumer {
    const consumer = this.session(sessionId).consumers.get(consumerId);

    if (!consumer) {
      throw new VoiceMediaObjectNotFoundError();
    }

    return consumer;
  }

  private transportFailed(sessionId: string, transport: types.WebRtcTransport): void {
    if (this.failedSessions.has(sessionId)) {
      return;
    }

    this.failedSessions.add(sessionId);

    if (this.failureHandlers.size === 0 && !transport.closed) {
      transport.close();
      return;
    }

    for (const handler of this.failureHandlers) {
      void Promise.resolve()
        .then(() => handler(sessionId))
        .catch((error: unknown) => {
          this.logger.error({
            message: "Failed to close voice session after transport failure",
            error,
            sessionId,
            transportId: transport.id,
            operation: "handleVoiceTransportFailure",
          });
        })
        .finally(() => {
          if (!transport.closed) transport.close();
        });
    }
  }
}
