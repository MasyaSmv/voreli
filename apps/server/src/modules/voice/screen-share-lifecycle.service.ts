import { Inject, Injectable, Logger } from "@nestjs/common";
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
import { VOICE_STATE_REPOSITORY, type VoiceStateRepository } from "./voice-state.repository.js";
import { ScreenShareViewingService } from "./screen-share-viewing.service.js";

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

  constructor(
    private readonly media: MediaSessionRegistry,
    private readonly access: VoiceChannelAccessService,
    private readonly broadcaster: VoiceBroadcaster,
    @Inject(VOICE_STATE_REPOSITORY) private readonly state: VoiceStateRepository,
    private readonly viewing: ScreenShareViewingService,
  ) {}

  activeIn(mediaRoomId: string): Promise<readonly ScreenShareView[]> {
    return this.state.screenShares(mediaRoomId);
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

    let pending = this.pendingBySession.get(context.participant.sessionId);
    if (payload.source === "screen-video") {
      if (
        [...this.activeById.values()].some(
          (screenShare) => screenShare.sessionId === context.participant.sessionId,
        )
      ) {
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
    try {
      await this.state.saveScreenShare(view);
    } catch (error: unknown) {
      this.activeById.delete(view.id);
      this.stopping.add(view.id);
      try {
        this.closeProducerIfPresent(view.sessionId, view.audioProducerId);
        this.closeProducerIfPresent(view.sessionId, view.videoProducerId);
      } finally {
        this.stopping.delete(view.id);
      }
      throw error;
    }
    this.broadcaster.screenStarted(view.mediaRoomId, view);
    return view;
  }

  async stop(
    userId: string,
    context: VoiceMediaSessionContext,
    screenStreamId: string,
  ): Promise<void> {
    const active = this.activeById.get(screenStreamId);
    if (!active || active.userId !== userId || active.sessionId !== context.participant.sessionId) {
      throw new ScreenShareStateError();
    }
    await this.stopActive(active, "stopped");
  }

  abort(userId: string, context: VoiceMediaSessionContext, screenStreamId: string): void {
    const pending = this.pendingBySession.get(context.participant.sessionId);
    if (
      !pending ||
      pending.id !== screenStreamId ||
      pending.userId !== userId ||
      pending.mediaRoomId !== context.mediaRoomId
    ) {
      throw new ScreenShareStateError();
    }
    this.pendingBySession.delete(pending.sessionId);
    this.stopping.add(pending.id);
    try {
      this.closeProducerIfPresent(pending.sessionId, pending.audioProducerId);
      this.closeProducerIfPresent(pending.sessionId, pending.videoProducerId);
    } finally {
      this.stopping.delete(pending.id);
    }
  }

  async stopAudio(
    userId: string,
    context: VoiceMediaSessionContext,
    screenStreamId: string,
  ): Promise<void> {
    const active = this.activeById.get(screenStreamId);
    if (
      !active ||
      active.userId !== userId ||
      active.sessionId !== context.participant.sessionId ||
      active.audioProducerId === null
    ) {
      throw new ScreenShareStateError();
    }
    const updated = { ...active, audioProducerId: null };
    this.activeById.set(screenStreamId, updated);
    this.stopping.add(screenStreamId);
    try {
      this.closeProducerIfPresent(active.sessionId, active.audioProducerId);
    } finally {
      this.stopping.delete(screenStreamId);
    }
    try {
      await this.state.saveScreenShare(updated);
    } finally {
      this.broadcaster.screenUpdated(active.mediaRoomId, updated);
    }
  }

  async stopForSession(
    sessionId: string,
    reason: "left" | "permission-revoked" | "failed",
  ): Promise<void> {
    this.viewing.stopSession(sessionId);
    const pending = this.pendingBySession.get(sessionId);
    if (pending) {
      this.pendingBySession.delete(sessionId);
      this.closeProducerIfPresent(sessionId, pending.audioProducerId);
      this.closeProducerIfPresent(sessionId, pending.videoProducerId);
    }
    const active = [...this.activeById.values()].find((share) => share.sessionId === sessionId);
    if (active) await this.stopActive(active, reason);
  }

  async stopForUser(userId: string, mediaRoomId: string): Promise<void> {
    const pending = [...this.pendingBySession.values()].find(
      (share) => share.userId === userId && share.mediaRoomId === mediaRoomId,
    );
    const active = [...this.activeById.values()].find(
      (share) => share.userId === userId && share.mediaRoomId === mediaRoomId,
    );
    if (pending) await this.stopForSession(pending.sessionId, "permission-revoked");
    else if (active) await this.stopForSession(active.sessionId, "permission-revoked");
  }

  producersFor(
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
    return this.producers(active);
  }

  private async handleProducerClosed(screenStreamId: string, producerId: string): Promise<void> {
    if (this.stopping.has(screenStreamId)) return;
    const active = this.activeById.get(screenStreamId);
    if (active) {
      if (producerId === active.audioProducerId) {
        const updated = { ...active, audioProducerId: null };
        this.activeById.set(screenStreamId, updated);
        try {
          await this.state.saveScreenShare(updated);
        } finally {
          this.broadcaster.screenUpdated(active.mediaRoomId, updated);
        }
      } else {
        await this.stopActive(active, "track-ended");
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

  private async stopActive(
    active: ScreenShareView & { readonly sessionId: string },
    reason: "stopped" | "track-ended" | "left" | "permission-revoked" | "failed",
  ): Promise<void> {
    this.stopping.add(active.id);
    this.activeById.delete(active.id);
    this.viewing.stopShare(active.id);
    let persistenceError: unknown;
    try {
      try {
        await this.state.removeScreenShare(active.mediaRoomId, active.id);
      } catch (error: unknown) {
        persistenceError = error;
      }
      this.closeProducerIfPresent(active.sessionId, active.audioProducerId);
      this.closeProducerIfPresent(active.sessionId, active.videoProducerId);
      this.broadcaster.screenStopped(active.mediaRoomId, active.id, reason);
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
