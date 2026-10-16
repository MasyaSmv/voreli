import { Injectable, Logger } from "@nestjs/common";
import {
  callIdFromMediaRoom,
  type CreateProducerPayload,
  type VoiceProducerView,
  type ScreenShareView,
} from "@voreli/shared";
import type { types } from "mediasoup";

import { ScreenShareForbiddenError, ScreenShareStateError } from "./errors/voice-media-errors.js";
import { MediaSessionRegistry } from "./media-session.registry.js";
import { VoiceChannelAccessService } from "./voice-channel-access.service.js";
import type { VoiceMediaSessionContext } from "./voice-media-session-context.service.js";
import { ScreenShareProjectionService } from "./screen-share-projection.service.js";
import { ScreenShareStateService, type ActiveScreenShare } from "./screen-share-state.service.js";
import { ScreenShareViewingService } from "./screen-share-viewing.service.js";

@Injectable()
export class ScreenShareLifecycleService {
  private readonly logger = new Logger(ScreenShareLifecycleService.name);
  constructor(
    private readonly media: MediaSessionRegistry,
    private readonly access: VoiceChannelAccessService,
    private readonly projection: ScreenShareProjectionService,
    private readonly viewing: ScreenShareViewingService,
    private readonly shares: ScreenShareStateService,
  ) {}

  activeIn(mediaRoomId: string): Promise<readonly ScreenShareView[]> {
    return this.projection.activeIn(mediaRoomId);
  }

  async createProducer(
    userId: string,
    context: VoiceMediaSessionContext,
    payload: CreateProducerPayload,
  ): Promise<types.Producer> {
    const streamId = payload.screenStreamId;
    if (
      callIdFromMediaRoom(context.mediaRoomId) !== null ||
      streamId === undefined ||
      !(await this.access.canShareScreen(userId, context.mediaRoomId))
    ) {
      throw new ScreenShareForbiddenError();
    }

    let pending = this.shares.pending(context.participant.sessionId);
    if (payload.source === "screen-video") {
      if (this.shares.activeForSession(context.participant.sessionId) !== undefined) {
        throw new ScreenShareStateError("A participant can share only one screen at a time");
      }
      if (pending && pending.id !== streamId) throw new ScreenShareStateError();
      pending ??= {
        id: streamId,
        mediaRoomId: context.mediaRoomId,
        userId,
        sessionId: context.participant.sessionId,
        videoProducerId: null,
        audioProducerId: null,
      };
      this.shares.begin(pending);
    } else if (!pending || pending.id !== streamId || pending.videoProducerId === null) {
      throw new ScreenShareStateError("Screen video must be created before screen audio");
    }

    let producer: types.Producer;
    try {
      producer = await this.media.createProducer(
        context.participant.sessionId,
        payload.transportId,
        payload.kind,
        payload.rtpParameters,
        false,
        payload.source,
        streamId,
      );
    } catch (error: unknown) {
      if (
        this.shares.pending(pending.sessionId)?.id === streamId &&
        pending.videoProducerId === null &&
        pending.audioProducerId === null
      ) {
        this.shares.removePending(pending.sessionId);
      }
      throw error;
    }
    if (!this.shares.recordProducer(pending.sessionId, streamId, producer.id, payload.source)) {
      // Aborted mid-creation: nothing will ever start or stop this producer, so it must not outlive the request.
      this.closeProducerIfPresent(pending.sessionId, producer.id);
      throw new ScreenShareStateError();
    }
    producer.observer.once("close", () => {
      void this.handleProducerClosed(streamId, producer.id).catch((error: unknown) =>
        this.logger.error({
          message: "Failed to reconcile a closed screen producer",
          error,
          screenStreamId: streamId,
          producerId: producer.id,
        }),
      );
    });
    return producer;
  }

  async start(
    userId: string,
    context: VoiceMediaSessionContext,
    videoProducerId: string,
    audioProducerId?: string,
  ): Promise<ScreenShareView> {
    const pending = this.shares.pending(context.participant.sessionId);
    if (
      !pending ||
      pending.userId !== userId ||
      pending.mediaRoomId !== context.mediaRoomId ||
      pending.videoProducerId !== videoProducerId ||
      pending.audioProducerId !== (audioProducerId ?? null)
    ) {
      throw new ScreenShareStateError();
    }
    const view: ActiveScreenShare = {
      id: pending.id,
      mediaRoomId: pending.mediaRoomId,
      userId,
      sessionId: pending.sessionId,
      videoProducerId,
      audioProducerId: pending.audioProducerId,
    };
    this.shares.removePending(pending.sessionId);
    this.shares.activate(view);
    try {
      await this.projection.save(view);
    } catch (error: unknown) {
      this.shares.removeActive(view.id);
      this.shares.startStopping(view.id);
      try {
        this.closeProducerIfPresent(view.sessionId, view.audioProducerId);
        this.closeProducerIfPresent(view.sessionId, view.videoProducerId);
      } finally {
        this.shares.stopStopping(view.id);
      }
      throw error;
    }
    this.projection.started(view);
    return view;
  }

  async stop(
    userId: string,
    context: VoiceMediaSessionContext,
    screenStreamId: string,
  ): Promise<void> {
    const active = this.shares.active(screenStreamId);
    if (!active || active.userId !== userId || active.sessionId !== context.participant.sessionId) {
      throw new ScreenShareStateError();
    }
    await this.stopActive(active, "stopped");
  }

  abort(userId: string, context: VoiceMediaSessionContext, screenStreamId: string): void {
    const pending = this.shares.pending(context.participant.sessionId);
    if (
      !pending ||
      pending.id !== screenStreamId ||
      pending.userId !== userId ||
      pending.mediaRoomId !== context.mediaRoomId
    ) {
      throw new ScreenShareStateError();
    }
    this.shares.removePending(pending.sessionId);
    this.shares.startStopping(pending.id);
    try {
      this.closeProducerIfPresent(pending.sessionId, pending.audioProducerId);
      this.closeProducerIfPresent(pending.sessionId, pending.videoProducerId);
    } finally {
      this.shares.stopStopping(pending.id);
    }
  }

  async stopAudio(
    userId: string,
    context: VoiceMediaSessionContext,
    screenStreamId: string,
  ): Promise<void> {
    const active = this.shares.active(screenStreamId);
    if (
      !active ||
      active.userId !== userId ||
      active.sessionId !== context.participant.sessionId ||
      active.audioProducerId === null
    ) {
      throw new ScreenShareStateError();
    }
    const updated = this.shares.withoutAudio(active);
    this.shares.startStopping(screenStreamId);
    try {
      this.closeProducerIfPresent(active.sessionId, active.audioProducerId);
    } finally {
      this.shares.stopStopping(screenStreamId);
    }
    try {
      await this.projection.save(updated);
    } finally {
      this.projection.updated(updated);
    }
  }

  async stopForSession(
    sessionId: string,
    reason: "left" | "permission-revoked" | "failed",
  ): Promise<void> {
    this.viewing.stopSession(sessionId);
    const pending = this.shares.pending(sessionId);
    if (pending) {
      this.shares.removePending(sessionId);
      this.closeProducerIfPresent(sessionId, pending.audioProducerId);
      this.closeProducerIfPresent(sessionId, pending.videoProducerId);
    }
    const active = this.shares.activeForSession(sessionId);
    if (active) await this.stopActive(active, reason);
  }

  async stopForUser(userId: string, mediaRoomId: string): Promise<void> {
    const pending = this.shares.pendingForUser(userId, mediaRoomId);
    const active = this.shares.activeForUser(userId, mediaRoomId);
    if (pending) await this.stopForSession(pending.sessionId, "permission-revoked");
    else if (active) await this.stopForSession(active.sessionId, "permission-revoked");
  }

  producersFor(
    context: VoiceMediaSessionContext,
    requestedMediaRoomId: string,
    screenStreamId: string,
  ): readonly VoiceProducerView[] {
    const active = this.shares.active(screenStreamId);
    if (
      requestedMediaRoomId !== context.mediaRoomId ||
      !active ||
      active.mediaRoomId !== context.mediaRoomId
    ) {
      throw new ScreenShareStateError();
    }
    return this.producers(active);
  }

  private async handleProducerClosed(screenStreamId: string, producerId: string): Promise<void> {
    if (this.shares.isStopping(screenStreamId)) return;
    const active = this.shares.active(screenStreamId);
    if (active) {
      if (producerId === active.audioProducerId) {
        const updated = this.shares.withoutAudio(active);
        try {
          await this.projection.save(updated);
        } finally {
          this.projection.updated(updated);
        }
      } else {
        await this.stopActive(active, "track-ended");
      }
      return;
    }
    const closed = this.shares.producerClosed(producerId);
    if (closed) this.closeProducerIfPresent(closed.sessionId, closed.audioProducerId);
  }

  private async stopActive(
    active: ActiveScreenShare,
    reason: "stopped" | "track-ended" | "left" | "permission-revoked" | "failed",
  ): Promise<void> {
    this.shares.startStopping(active.id);
    this.shares.removeActive(active.id);
    this.viewing.stopShare(active.id);
    let persistenceError: unknown;
    try {
      try {
        await this.projection.remove(active.mediaRoomId, active.id);
      } catch (error: unknown) {
        persistenceError = error;
      }
      this.closeProducerIfPresent(active.sessionId, active.audioProducerId);
      this.closeProducerIfPresent(active.sessionId, active.videoProducerId);
      this.projection.stopped(active.mediaRoomId, active.id, reason);
      if (persistenceError) {
        throw persistenceError instanceof Error
          ? persistenceError
          : new Error("Failed to remove persisted screen share", { cause: persistenceError });
      }
    } catch (error: unknown) {
      this.logger.error({
        message: "Failed to stop screen share",
        error,
        screenStreamId: active.id,
      });
      throw error;
    } finally {
      this.shares.stopStopping(active.id);
    }
  }

  private closeProducerIfPresent(sessionId: string, producerId: string | null): void {
    if (producerId && this.media.producerOfSession(sessionId, producerId)) {
      this.media.closeProducer(sessionId, producerId);
    }
  }

  private producers(active: ActiveScreenShare): readonly VoiceProducerView[] {
    return [active.videoProducerId, active.audioProducerId]
      .filter((producerId): producerId is string => producerId !== null)
      .map((producerId) => this.media.producerOfSession(active.sessionId, producerId))
      .filter((producer): producer is VoiceProducerView => producer !== null);
  }
}
