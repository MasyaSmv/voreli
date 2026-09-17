import { Inject, Injectable } from "@nestjs/common";
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
  SetVoiceSelfStatePayload,
  VoiceParticipantView,
} from "@voreli/shared";

import {
  VoiceSessionNotFoundError,
  VoiceSpeakForbiddenError,
} from "./errors/voice-media-errors.js";
import { MediaSessionRegistry } from "./media-session.registry.js";
import { SpeakingService } from "./speaking.service.js";
import {
  VOICE_STATE_REPOSITORY,
  type VoiceParticipantState,
  type VoiceStateRepository,
} from "./voice-state.repository.js";
import { VoiceBroadcaster } from "./voice-broadcaster.js";
import { MediaRoomAccessService } from "./media-room-access.service.js";
import { VoiceParticipantControlService } from "./voice-participant-control.service.js";

@Injectable()
export class VoiceSignalingService {
  constructor(
    @Inject(VOICE_STATE_REPOSITORY) private readonly state: VoiceStateRepository,
    private readonly media: MediaSessionRegistry,
    private readonly access: MediaRoomAccessService,
    private readonly speaking: SpeakingService,
    private readonly broadcaster: VoiceBroadcaster,
    private readonly controls: VoiceParticipantControlService,
  ) {}

  async createTransport(
    userId: string,
    authenticationSessionId: string,
    payload: CreateTransportPayload,
  ): Promise<CreateTransportResponse> {
    const { participant } = await this.context(userId, authenticationSessionId);
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
    const { participant } = await this.context(userId, authenticationSessionId);
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
    const { participant } = await this.context(userId, authenticationSessionId);
    return {
      iceParameters: await this.media.restartIce(participant.sessionId, payload.transportId),
    };
  }

  async createProducer(
    userId: string,
    authenticationSessionId: string,
    payload: CreateProducerPayload,
  ): Promise<CreateProducerResponse> {
    const { channelId, participant } = await this.context(userId, authenticationSessionId);
    if (!(await this.access.canSpeak(userId, channelId))) throw new VoiceSpeakForbiddenError();

    const producer = await this.media.createProducer(
      participant.sessionId,
      payload.transportId,
      payload.kind,
      payload.rtpParameters,
      participant.selfMuted || participant.moderatorMuted,
      payload.source,
      payload.screenStreamId ?? null,
    );

    await this.speaking.addProducer(channelId, userId, producer);
    producer.observer.once("close", () => {
      this.speaking.forgetProducer(channelId, producer.id);
      this.broadcaster.producerClosed(channelId, producer.id);
    });
    this.broadcaster.producerCreated(channelId, {
      userId,
      producerId: producer.id,
      kind: producer.kind,
      source: payload.source,
      screenStreamId: payload.screenStreamId ?? null,
    });

    return { producerId: producer.id };
  }

  async createConsumer(
    userId: string,
    authenticationSessionId: string,
    payload: CreateConsumerPayload,
  ): Promise<CreateConsumerResponse> {
    const { participant } = await this.context(userId, authenticationSessionId);
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
    const { participant } = await this.context(userId, authenticationSessionId);
    await this.media.resumeConsumer(
      participant.sessionId,
      payload.consumerId,
      participant.selfDeafened || participant.moderatorDeafened,
    );
  }

  async setSelfState(
    userId: string,
    authenticationSessionId: string,
    payload: SetVoiceSelfStatePayload,
  ): Promise<VoiceParticipantView> {
    return this.controls.setSelfState(userId, authenticationSessionId, payload);
  }

  async closeProducersForUser(userId: string): Promise<void> {
    const channelId = await this.state.channelOf(userId);
    if (!channelId) return;
    const participant = await this.state.participant(channelId, userId);
    if (!participant || !this.media.has(participant.sessionId)) return;

    for (const producer of this.media.producersOfSession(participant.sessionId)) {
      await this.speaking.removeProducer(channelId, producer.producerId);
      this.media.closeProducer(participant.sessionId, producer.producerId);
    }
  }

  private async context(
    userId: string,
    authenticationSessionId: string,
  ): Promise<{ channelId: string; participant: VoiceParticipantState }> {
    const channelId = await this.state.channelOf(userId);
    if (!channelId) throw new VoiceSessionNotFoundError();
    const participant = await this.state.participant(channelId, userId);
    if (
      !participant ||
      participant.authenticationSessionId !== authenticationSessionId ||
      !this.media.has(participant.sessionId)
    )
      throw new VoiceSessionNotFoundError();
    return { channelId, participant };
  }

  private view(participant: VoiceParticipantState): VoiceParticipantView {
    return {
      userId: participant.userId,
      selfMuted: participant.selfMuted,
      selfDeafened: participant.selfDeafened,
      moderatorMuted: participant.moderatorMuted,
      moderatorDeafened: participant.moderatorDeafened,
      producers: this.media.producersOfSession(participant.sessionId),
    };
  }
}
