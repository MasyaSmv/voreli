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
import { VoiceBroadcaster } from "./voice-broadcaster.js";
import { VoiceChannelAccessService } from "./voice-channel-access.service.js";
import type { VoiceMediaSessionContext } from "./voice-media-session-context.service.js";

interface PendingScreenShare {
  readonly id: string;
  readonly mediaRoomId: string;
  readonly userId: string;
  readonly sessionId: string;
  videoProducerId: string | null;
  audioProducerId: string | null;
}

@Injectable()
export class ScreenShareLifecycleService {
  private readonly logger = new Logger(ScreenShareLifecycleService.name);
  private readonly pendingBySession = new Map<string, PendingScreenShare>();
  private readonly activeById = new Map<string, ScreenShareView & { readonly sessionId: string }>();
  private readonly stopping = new Set<string>();
  private readonly watchedBySession = new Map<string, string>();

  constructor(
    private readonly media: MediaSessionRegistry,
    private readonly access: VoiceChannelAccessService,
    private readonly broadcaster: VoiceBroadcaster,
  ) {}

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

    let pending = this.pendingBySession.get(context.participant.sessionId);
    if (payload.source === "screen-video") {
      if (pending && pending.id !== streamId) throw new ScreenShareStateError();
      pending ??= {
        id: streamId,
        mediaRoomId: context.mediaRoomId,
        userId,
        sessionId: context.participant.sessionId,
        videoProducerId: null,
        audioProducerId: null,
      };
      this.pendingBySession.set(context.participant.sessionId, pending);
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
      if (pending.videoProducerId === null && pending.audioProducerId === null) {
        this.pendingBySession.delete(pending.sessionId);
      }
      throw error;
    }
    if (payload.source === "screen-video") pending.videoProducerId = producer.id;
    else pending.audioProducerId = producer.id;
    producer.observer.once("close", () => this.handleProducerClosed(streamId, producer.id));
    return producer;
  }

  start(
    userId: string,
    context: VoiceMediaSessionContext,
    videoProducerId: string,
    audioProducerId?: string,
  ): ScreenShareView {
    const pending = this.pendingBySession.get(context.participant.sessionId);
    if (
      !pending ||
      pending.userId !== userId ||
      pending.mediaRoomId !== context.mediaRoomId ||
      pending.videoProducerId !== videoProducerId ||
      pending.audioProducerId !== (audioProducerId ?? null)
    ) {
      throw new ScreenShareStateError();
    }
    const view: ScreenShareView & { readonly sessionId: string } = {
      id: pending.id,
      mediaRoomId: pending.mediaRoomId,
      userId,
      sessionId: pending.sessionId,
      videoProducerId,
      audioProducerId: pending.audioProducerId,
    };
    this.pendingBySession.delete(pending.sessionId);
    this.activeById.set(view.id, view);
    this.broadcaster.screenStarted(view.mediaRoomId, view);
    return view;
  }

  stop(userId: string, context: VoiceMediaSessionContext, screenStreamId: string): void {
    const active = this.activeById.get(screenStreamId);
    if (!active || active.userId !== userId || active.sessionId !== context.participant.sessionId) {
      throw new ScreenShareStateError();
    }
    this.stopActive(active, "stopped");
  }

  stopForSession(sessionId: string, reason: "left" | "permission-revoked" | "failed"): void {
    this.watchedBySession.delete(sessionId);
    const pending = this.pendingBySession.get(sessionId);
    if (pending) {
      this.pendingBySession.delete(sessionId);
      this.closeProducerIfPresent(sessionId, pending.audioProducerId);
      this.closeProducerIfPresent(sessionId, pending.videoProducerId);
    }
    const active = [...this.activeById.values()].find((share) => share.sessionId === sessionId);
    if (active) this.stopActive(active, reason);
  }

  stopForUser(userId: string, mediaRoomId: string): void {
    const pending = [...this.pendingBySession.values()].find(
      (share) => share.userId === userId && share.mediaRoomId === mediaRoomId,
    );
    const active = [...this.activeById.values()].find(
      (share) => share.userId === userId && share.mediaRoomId === mediaRoomId,
    );
    if (pending) this.stopForSession(pending.sessionId, "permission-revoked");
    else if (active) this.stopForSession(active.sessionId, "permission-revoked");
  }

  watch(
    context: VoiceMediaSessionContext,
    requestedMediaRoomId: string,
    screenStreamId: string,
  ): readonly VoiceProducerView[] {
    const active = this.activeById.get(screenStreamId);
    if (
      requestedMediaRoomId !== context.mediaRoomId ||
      !active ||
      active.mediaRoomId !== context.mediaRoomId
    ) {
      throw new ScreenShareStateError();
    }
    const previous = this.watchedBySession.get(context.participant.sessionId);
    if (previous && previous !== screenStreamId) {
      this.unwatch(context, context.mediaRoomId, previous);
    }
    this.watchedBySession.set(context.participant.sessionId, screenStreamId);
    return this.producers(active);
  }

  unwatch(
    context: VoiceMediaSessionContext,
    requestedMediaRoomId: string,
    screenStreamId: string,
  ): void {
    if (requestedMediaRoomId !== context.mediaRoomId) throw new ScreenShareStateError();
    if (this.watchedBySession.get(context.participant.sessionId) !== screenStreamId) return;
    const active = this.activeById.get(screenStreamId);
    this.watchedBySession.delete(context.participant.sessionId);
    if (active) {
      this.media.closeConsumersForProducers(
        context.participant.sessionId,
        new Set(this.producers(active).map((producer) => producer.producerId)),
      );
    }
  }

  canConsume(sessionId: string, producerId: string): boolean {
    const screenStreamId = this.watchedBySession.get(sessionId);
    const active = screenStreamId ? this.activeById.get(screenStreamId) : undefined;
    return active
      ? this.producers(active).some((producer) => producer.producerId === producerId)
      : false;
  }

  async setLayer(
    context: VoiceMediaSessionContext,
    requestedMediaRoomId: string,
    screenStreamId: string,
    spatialLayer: 0 | 1 | 2,
  ): Promise<void> {
    if (
      requestedMediaRoomId !== context.mediaRoomId ||
      this.watchedBySession.get(context.participant.sessionId) !== screenStreamId
    ) {
      throw new ScreenShareStateError();
    }
    const active = this.activeById.get(screenStreamId);
    if (!active) throw new ScreenShareStateError();
    await this.media.setPreferredScreenLayer(
      context.participant.sessionId,
      new Set(this.producers(active).map((producer) => producer.producerId)),
      spatialLayer,
    );
  }

  private handleProducerClosed(screenStreamId: string, producerId: string): void {
    if (this.stopping.has(screenStreamId)) return;
    const active = this.activeById.get(screenStreamId);
    if (active) {
      if (producerId === active.audioProducerId) {
        const updated = { ...active, audioProducerId: null };
        this.activeById.set(screenStreamId, updated);
        this.broadcaster.screenUpdated(active.mediaRoomId, updated);
      } else {
        this.stopActive(active, "track-ended");
      }
      return;
    }
    for (const [sessionId, pending] of this.pendingBySession) {
      if (pending.videoProducerId !== producerId && pending.audioProducerId !== producerId)
        continue;
      if (pending.audioProducerId === producerId) {
        pending.audioProducerId = null;
      } else {
        this.pendingBySession.delete(sessionId);
        this.closeProducerIfPresent(sessionId, pending.audioProducerId);
      }
      break;
    }
  }

  private stopActive(
    active: ScreenShareView & { readonly sessionId: string },
    reason: "stopped" | "track-ended" | "left" | "permission-revoked" | "failed",
  ): void {
    this.stopping.add(active.id);
    this.activeById.delete(active.id);
    for (const [sessionId, watched] of this.watchedBySession) {
      if (watched === active.id) this.watchedBySession.delete(sessionId);
    }
    try {
      this.closeProducerIfPresent(active.sessionId, active.audioProducerId);
      this.closeProducerIfPresent(active.sessionId, active.videoProducerId);
      this.broadcaster.screenStopped(active.mediaRoomId, active.id, reason);
    } catch (error: unknown) {
      this.logger.error({
        message: "Failed to stop screen share",
        error,
        screenStreamId: active.id,
      });
      throw error;
    } finally {
      this.stopping.delete(active.id);
    }
  }

  private closeProducerIfPresent(sessionId: string, producerId: string | null): void {
    if (producerId && this.media.producerOfSession(sessionId, producerId)) {
      this.media.closeProducer(sessionId, producerId);
    }
  }

  private producers(
    active: ScreenShareView & { readonly sessionId: string },
  ): readonly VoiceProducerView[] {
    return [active.videoProducerId, active.audioProducerId]
      .filter((producerId): producerId is string => producerId !== null)
      .map((producerId) => this.media.producerOfSession(active.sessionId, producerId))
      .filter((producer): producer is VoiceProducerView => producer !== null);
  }
}
