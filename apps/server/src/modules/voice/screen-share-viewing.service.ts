import { Injectable } from "@nestjs/common";
import type { VoiceProducerView } from "@voreli/shared";

import { ScreenShareStateError } from "./errors/voice-media-errors.js";
import { MediaSessionRegistry } from "./media-session.registry.js";
import type { VoiceMediaSessionContext } from "./voice-media-session-context.service.js";

interface WatchedScreenShare {
  readonly screenStreamId: string;
  readonly producerIds: ReadonlySet<string>;
  readonly videoProducerId: string;
}

/** Owns which one screen share each media session receives; it never mutates the share itself. */
@Injectable()
export class ScreenShareViewingService {
  private readonly watchedBySession = new Map<string, WatchedScreenShare>();

  constructor(private readonly media: MediaSessionRegistry) {}

  watch(
    context: VoiceMediaSessionContext,
    screenStreamId: string,
    producers: readonly VoiceProducerView[],
  ): void {
    const video = producers.find((producer) => producer.source === "screen-video");
    if (!video) throw new ScreenShareStateError();
    const previous = this.watchedBySession.get(context.participant.sessionId);
    if (previous && previous.screenStreamId !== screenStreamId) {
      this.close(context.participant.sessionId, previous);
    }
    this.watchedBySession.set(context.participant.sessionId, {
      screenStreamId,
      producerIds: new Set(producers.map((producer) => producer.producerId)),
      videoProducerId: video.producerId,
    });
  }

  unwatch(
    context: VoiceMediaSessionContext,
    requestedMediaRoomId: string,
    screenStreamId: string,
  ): void {
    if (requestedMediaRoomId !== context.mediaRoomId) throw new ScreenShareStateError();
    const watched = this.watchedBySession.get(context.participant.sessionId);
    if (watched?.screenStreamId !== screenStreamId) return;
    this.close(context.participant.sessionId, watched);
  }

  canConsume(sessionId: string, producerId: string): boolean {
    return this.watchedBySession.get(sessionId)?.producerIds.has(producerId) ?? false;
  }

  async setLayer(
    context: VoiceMediaSessionContext,
    requestedMediaRoomId: string,
    screenStreamId: string,
    spatialLayer: 0 | 1 | 2,
  ): Promise<void> {
    const watched = this.requireWatched(context, requestedMediaRoomId, screenStreamId);
    await this.media.setPreferredScreenLayer(
      context.participant.sessionId,
      watched.producerIds,
      spatialLayer,
    );
  }

  async setVisible(
    context: VoiceMediaSessionContext,
    requestedMediaRoomId: string,
    screenStreamId: string,
    visible: boolean,
  ): Promise<void> {
    const watched = this.requireWatched(context, requestedMediaRoomId, screenStreamId);
    await this.media.setScreenConsumersPaused(
      context.participant.sessionId,
      new Set([watched.videoProducerId]),
      !visible,
    );
  }

  stopSession(sessionId: string): void {
    this.watchedBySession.delete(sessionId);
  }

  stopShare(screenStreamId: string): void {
    for (const [sessionId, watched] of this.watchedBySession) {
      if (watched.screenStreamId === screenStreamId) this.watchedBySession.delete(sessionId);
    }
  }

  private requireWatched(
    context: VoiceMediaSessionContext,
    requestedMediaRoomId: string,
    screenStreamId: string,
  ): WatchedScreenShare {
    const watched = this.watchedBySession.get(context.participant.sessionId);
    if (
      requestedMediaRoomId !== context.mediaRoomId ||
      watched?.screenStreamId !== screenStreamId
    ) {
      throw new ScreenShareStateError();
    }
    return watched;
  }

  private close(sessionId: string, watched: WatchedScreenShare): void {
    this.watchedBySession.delete(sessionId);
    this.media.closeConsumersForProducers(sessionId, watched.producerIds);
  }
}
