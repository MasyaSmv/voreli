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
import { VoiceChannelAccessService } from "./voice-channel-access.service.js";

@Injectable()
export class VoiceSignalingService {
  constructor(
    @Inject(VOICE_STATE_REPOSITORY) private readonly state: VoiceStateRepository,
    private readonly media: MediaSessionRegistry,
    private readonly access: VoiceChannelAccessService,
    private readonly speaking: SpeakingService,
    private readonly broadcaster: VoiceBroadcaster,
  ) {}

  async createTransport(
    userId: string,
    payload: CreateTransportPayload,
  ): Promise<CreateTransportResponse> {
    const { participant } = await this.context(userId);
    const transport = await this.media.createTransport(participant.sessionId, payload.direction);
    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  async connectTransport(userId: string, payload: ConnectTransportPayload): Promise<void> {
    const { participant } = await this.context(userId);
    await this.media.connectTransport(
      participant.sessionId,
      payload.transportId,
      payload.dtlsParameters,
    );
  }

  async restartIce(userId: string, payload: RestartIcePayload): Promise<RestartIceResponse> {
    const { participant } = await this.context(userId);
    return {
      iceParameters: await this.media.restartIce(participant.sessionId, payload.transportId),
    };
  }

  async createProducer(
    userId: string,
    payload: CreateProducerPayload,
  ): Promise<CreateProducerResponse> {
    const { channelId, participant } = await this.context(userId);
    if (!(await this.access.canSpeak(userId, channelId))) throw new VoiceSpeakForbiddenError();

    const producer = await this.media.createProducer(
      participant.sessionId,
      payload.transportId,
      payload.kind,
      payload.rtpParameters,
      participant.selfMuted || participant.moderatorMuted,
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
    });

    return { producerId: producer.id };
  }

  async createConsumer(
    userId: string,
    payload: CreateConsumerPayload,
  ): Promise<CreateConsumerResponse> {
    const { participant } = await this.context(userId);
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

  async resumeConsumer(userId: string, payload: ResumeConsumerPayload): Promise<void> {
    const { participant } = await this.context(userId);
    await this.media.resumeConsumer(
      participant.sessionId,
      payload.consumerId,
      participant.selfDeafened,
    );
  }

  async setSelfState(
    userId: string,
    payload: SetVoiceSelfStatePayload,
  ): Promise<VoiceParticipantView> {
    const { channelId, participant: before } = await this.context(userId);
    const participant = await this.state.updateSelfState(
      channelId,
      userId,
      before.sessionId,
      payload.selfMuted,
      payload.selfDeafened,
    );
    if (!participant) throw new VoiceSessionNotFoundError();

    try {
      await Promise.all([
        this.media.setProducerPaused(
          participant.sessionId,
          participant.selfMuted || participant.moderatorMuted,
        ),
        this.media.setConsumersPaused(participant.sessionId, participant.selfDeafened),
      ]);
    } catch (error: unknown) {
      await this.state.updateSelfState(
        channelId,
        userId,
        before.sessionId,
        before.selfMuted,
        before.selfDeafened,
      );
      await Promise.all([
        this.media.setProducerPaused(before.sessionId, before.selfMuted || before.moderatorMuted),
        this.media.setConsumersPaused(before.sessionId, before.selfDeafened),
      ]);
      throw error;
    }

    const view = this.view(participant);
    this.broadcaster.participantUpdated(channelId, view);
    return view;
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
  ): Promise<{ channelId: string; participant: VoiceParticipantState }> {
    const channelId = await this.state.channelOf(userId);
    if (!channelId) throw new VoiceSessionNotFoundError();
    const participant = await this.state.participant(channelId, userId);
    if (!participant || !this.media.has(participant.sessionId))
      throw new VoiceSessionNotFoundError();
    return { channelId, participant };
  }

  private view(participant: VoiceParticipantState): VoiceParticipantView {
    return {
      userId: participant.userId,
      selfMuted: participant.selfMuted,
      selfDeafened: participant.selfDeafened,
      producers: this.media.producersOfSession(participant.sessionId),
    };
  }
}
