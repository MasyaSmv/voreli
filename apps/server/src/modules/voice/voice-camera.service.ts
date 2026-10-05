import { Injectable } from "@nestjs/common";
import type { CreateProducerPayload, StopCameraPayload } from "@voreli/shared";
import { callIdFromMediaRoom } from "@voreli/shared";
import type { types } from "mediasoup";

import {
  CameraForbiddenError,
  VoiceMediaObjectNotFoundError,
} from "./errors/voice-media-errors.js";
import { MediaRoomAccessService } from "./media-room-access.service.js";
import { MediaSessionRegistry } from "./media-session.registry.js";
import { VoiceBroadcaster } from "./voice-broadcaster.js";
import type { VoiceMediaSessionContext } from "./voice-media-session-context.service.js";

@Injectable()
export class VoiceCameraService {
  constructor(
    private readonly access: MediaRoomAccessService,
    private readonly media: MediaSessionRegistry,
    private readonly broadcaster: VoiceBroadcaster,
  ) {}

  async create(
    userId: string,
    authenticationSessionId: string,
    context: VoiceMediaSessionContext,
    payload: CreateProducerPayload,
  ): Promise<types.Producer> {
    await this.assertParticipant(userId, authenticationSessionId, context.mediaRoomId);
    const producer = await this.media.createProducer(
      context.participant.sessionId,
      payload.transportId,
      payload.kind,
      payload.rtpParameters,
      false,
      payload.source,
      payload.screenStreamId ?? null,
    );
    producer.observer.once("close", () => {
      this.broadcaster.producerClosed(context.mediaRoomId, producer.id);
    });
    this.broadcaster.producerCreated(context.mediaRoomId, {
      userId,
      producerId: producer.id,
      kind: producer.kind,
      source: "camera-video",
      screenStreamId: null,
    });
    return producer;
  }

  async stop(
    userId: string,
    authenticationSessionId: string,
    context: VoiceMediaSessionContext,
    payload: StopCameraPayload,
  ): Promise<void> {
    if (payload.mediaRoomId !== context.mediaRoomId) throw new CameraForbiddenError();
    await this.assertParticipant(userId, authenticationSessionId, context.mediaRoomId);
    const producer = this.media.producerOfSession(
      context.participant.sessionId,
      payload.producerId,
    );
    if (!producer) {
      if (this.media.producerSource(payload.producerId) !== null) {
        throw new VoiceMediaObjectNotFoundError();
      }
      return;
    }
    if (producer.source !== "camera-video") throw new VoiceMediaObjectNotFoundError();
    this.media.closeProducer(context.participant.sessionId, payload.producerId);
  }

  assertCanConsume(
    userId: string,
    authenticationSessionId: string,
    mediaRoomId: string,
  ): Promise<void> {
    return this.assertParticipant(userId, authenticationSessionId, mediaRoomId);
  }

  private async assertParticipant(
    userId: string,
    authenticationSessionId: string,
    mediaRoomId: string,
  ): Promise<void> {
    if (callIdFromMediaRoom(mediaRoomId) === null) throw new CameraForbiddenError();
    await this.access.assertConnect(userId, authenticationSessionId, mediaRoomId);
  }
}
