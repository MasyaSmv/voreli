import { Injectable } from "@nestjs/common";
import type {
  ConnectTransportPayload,
  CreateConsumerPayload,
  CreateConsumerResponse,
  CreateProducerPayload,
  CreateProducerResponse,
  CreateTransportPayload,
  CreateTransportResponse,
  RestartIcePayload,
  RestartIceResponse,
  ResumeConsumerPayload,
  StopCameraPayload,
  SetVoiceModeratorStatePayload,
  SetVoiceSelfStatePayload,
  VoiceParticipantView,
} from "@voreli/shared";

import { VoiceCannotConsumeError } from "./errors/voice-media-errors.js";
import { MediaSessionRegistry } from "./media-session.registry.js";
import { VoiceParticipantControlService } from "./voice-participant-control.service.js";
import { VoiceMediaSessionContextService } from "./voice-media-session-context.service.js";
import { ScreenShareSignalingService } from "./screen-share-signaling.service.js";
import { VoiceMicrophoneService } from "./voice-microphone.service.js";
import { VoiceCameraService } from "./voice-camera.service.js";

@Injectable()
export class VoiceSignalingService {
  constructor(
    private readonly media: MediaSessionRegistry,
    private readonly controls: VoiceParticipantControlService,
    private readonly contexts: VoiceMediaSessionContextService,
    private readonly screenShares: ScreenShareSignalingService,
    private readonly microphone: VoiceMicrophoneService,
    private readonly camera: VoiceCameraService,
  ) {}

  async createTransport(
    userId: string,
    authenticationSessionId: string,
    payload: CreateTransportPayload,
  ): Promise<CreateTransportResponse> {
    const { participant } = await this.contexts.resolve(userId, authenticationSessionId);
    const transport = await this.media.createTransport(participant.sessionId, payload.direction);
    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  async connectTransport(
    userId: string,
    authenticationSessionId: string,
    payload: ConnectTransportPayload,
  ): Promise<void> {
    const { participant } = await this.contexts.resolve(userId, authenticationSessionId);
    await this.media.connectTransport(
      participant.sessionId,
      payload.transportId,
      payload.dtlsParameters,
    );
  }

  async restartIce(
    userId: string,
    authenticationSessionId: string,
    payload: RestartIcePayload,
  ): Promise<RestartIceResponse> {
    const { participant } = await this.contexts.resolve(userId, authenticationSessionId);
    return {
      iceParameters: await this.media.restartIce(participant.sessionId, payload.transportId),
    };
  }

  async createProducer(
    userId: string,
    authenticationSessionId: string,
    payload: CreateProducerPayload,
  ): Promise<CreateProducerResponse> {
    const context = await this.contexts.resolve(userId, authenticationSessionId);

    if (payload.source === "camera-video") {
      const producer = await this.camera.create(userId, authenticationSessionId, context, payload);
      return { producerId: producer.id };
    }
    if (payload.source !== "microphone") {
      const producer = await this.screenShares.createProducer(userId, context, payload);
      return { producerId: producer.id };
    }
    const producer = await this.microphone.create(userId, context, payload);
    return { producerId: producer.id };
  }

  async createConsumer(
    userId: string,
    authenticationSessionId: string,
    payload: CreateConsumerPayload,
  ): Promise<CreateConsumerResponse> {
    const { participant, mediaRoomId } = await this.contexts.resolve(
      userId,
      authenticationSessionId,
    );
    const source = this.media.producerSource(payload.producerId);
    if (source === "camera-video") {
      await this.camera.assertCanConsume(userId, authenticationSessionId, mediaRoomId);
    } else if (
      source !== "microphone" &&
      !this.screenShares.canConsume(participant.sessionId, payload.producerId)
    ) {
      throw new VoiceCannotConsumeError();
    }
    const consumer = await this.media.createConsumer(
      participant.sessionId,
      payload.transportId,
      payload.producerId,
      payload.rtpCapabilities,
    );
    return {
      consumerId: consumer.id,
      producerId: consumer.producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    };
  }

  async resumeConsumer(
    userId: string,
    authenticationSessionId: string,
    payload: ResumeConsumerPayload,
  ): Promise<void> {
    const { participant } = await this.contexts.resolve(userId, authenticationSessionId);
    await this.media.resumeConsumer(
      participant.sessionId,
      payload.consumerId,
      participant.selfDeafened || participant.moderatorDeafened,
    );
  }

  async stopCamera(
    userId: string,
    authenticationSessionId: string,
    payload: StopCameraPayload,
  ): Promise<void> {
    const context = await this.contexts.resolve(userId, authenticationSessionId);
    await this.camera.stop(userId, authenticationSessionId, context, payload);
  }

  async setSelfState(
    userId: string,
    authenticationSessionId: string,
    payload: SetVoiceSelfStatePayload,
  ): Promise<VoiceParticipantView> {
    return this.controls.setSelfState(userId, authenticationSessionId, payload);
  }

  setModeratorState(
    userId: string,
    payload: SetVoiceModeratorStatePayload,
  ): Promise<VoiceParticipantView> {
    return this.controls.setModeratorState(userId, payload);
  }

  async closeProducersForUser(userId: string): Promise<void> {
    await this.microphone.closeForUser(userId);
  }
}
