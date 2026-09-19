import { Injectable } from "@nestjs/common";
import type {
  CreateProducerPayload,
  ScreenShareLayerPayload,
  ScreenSharePayload,
  ScreenShareProducersResponse,
  ScreenShareResponse,
  ScreenShareVisibilityPayload,
  StartScreenSharePayload,
} from "@voreli/shared";
import type { types } from "mediasoup";

import { VoiceSessionNotFoundError } from "./errors/voice-media-errors.js";
import { ScreenShareLifecycleService } from "./screen-share-lifecycle.service.js";
import { ScreenShareViewingService } from "./screen-share-viewing.service.js";
import {
  VoiceMediaSessionContextService,
  type VoiceMediaSessionContext,
} from "./voice-media-session-context.service.js";

/** Resolves one authenticated media session and applies screen-share commands to it. */
@Injectable()
export class ScreenShareSignalingService {
  constructor(
    private readonly contexts: VoiceMediaSessionContextService,
    private readonly lifecycle: ScreenShareLifecycleService,
    private readonly viewing: ScreenShareViewingService,
  ) {}

  canConsume(sessionId: string, producerId: string): boolean {
    return this.viewing.canConsume(sessionId, producerId);
  }

  createProducer(
    userId: string,
    context: VoiceMediaSessionContext,
    payload: CreateProducerPayload,
  ): Promise<types.Producer> {
    return this.lifecycle.createProducer(userId, context, payload);
  }

  async start(
    userId: string,
    authenticationSessionId: string,
    command: StartScreenSharePayload,
  ): Promise<ScreenShareResponse> {
    const context = await this.resolve(userId, authenticationSessionId, command.mediaRoomId);
    return {
      screenShare: await this.lifecycle.start(
        userId,
        context,
        command.videoProducerId,
        command.audioProducerId,
      ),
    };
  }

  async stop(
    userId: string,
    authenticationSessionId: string,
    command: ScreenSharePayload,
  ): Promise<void> {
    const context = await this.resolve(userId, authenticationSessionId, command.mediaRoomId);
    await this.lifecycle.stop(userId, context, command.screenStreamId);
  }

  async abort(
    userId: string,
    authenticationSessionId: string,
    command: ScreenSharePayload,
  ): Promise<void> {
    const context = await this.resolve(userId, authenticationSessionId, command.mediaRoomId);
    this.lifecycle.abort(userId, context, command.screenStreamId);
  }

  async watch(
    userId: string,
    authenticationSessionId: string,
    command: ScreenSharePayload,
  ): Promise<ScreenShareProducersResponse> {
    const context = await this.resolve(userId, authenticationSessionId, command.mediaRoomId);
    const producers = this.lifecycle.producersFor(
      context,
      command.mediaRoomId,
      command.screenStreamId,
    );
    this.viewing.watch(context, command.screenStreamId, producers);
    return { producers };
  }

  async stopAudio(
    userId: string,
    authenticationSessionId: string,
    command: ScreenSharePayload,
  ): Promise<void> {
    const context = await this.resolve(userId, authenticationSessionId, command.mediaRoomId);
    await this.lifecycle.stopAudio(userId, context, command.screenStreamId);
  }

  async unwatch(
    userId: string,
    authenticationSessionId: string,
    command: ScreenSharePayload,
  ): Promise<void> {
    const context = await this.resolve(userId, authenticationSessionId, command.mediaRoomId);
    this.viewing.unwatch(context, command.mediaRoomId, command.screenStreamId);
  }

  async setLayer(
    userId: string,
    authenticationSessionId: string,
    command: ScreenShareLayerPayload,
  ): Promise<void> {
    const context = await this.resolve(userId, authenticationSessionId, command.mediaRoomId);
    await this.viewing.setLayer(
      context,
      command.mediaRoomId,
      command.screenStreamId,
      command.spatialLayer,
    );
  }

  async setVisible(
    userId: string,
    authenticationSessionId: string,
    command: ScreenShareVisibilityPayload,
  ): Promise<void> {
    const context = await this.resolve(userId, authenticationSessionId, command.mediaRoomId);
    await this.viewing.setVisible(
      context,
      command.mediaRoomId,
      command.screenStreamId,
      command.visible,
    );
  }

  private async resolve(
    userId: string,
    authenticationSessionId: string,
    mediaRoomId: string,
  ): Promise<VoiceMediaSessionContext> {
    const context = await this.contexts.resolve(userId, authenticationSessionId);
    if (context.mediaRoomId !== mediaRoomId) throw new VoiceSessionNotFoundError();
    return context;
  }
}
