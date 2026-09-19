import { Inject, Injectable } from "@nestjs/common";
import type { CreateProducerPayload } from "@voreli/shared";
import type { types } from "mediasoup";

import { VoiceSpeakForbiddenError } from "./errors/voice-media-errors.js";
import { MediaRoomAccessService } from "./media-room-access.service.js";
import { MediaSessionRegistry } from "./media-session.registry.js";
import { SpeakingService } from "./speaking.service.js";
import { VoiceBroadcaster } from "./voice-broadcaster.js";
import type { VoiceMediaSessionContext } from "./voice-media-session-context.service.js";
import { VOICE_STATE_REPOSITORY, type VoiceStateRepository } from "./voice-state.repository.js";

/** Owns microphone Producer creation, speaking observation and terminal removal. */
@Injectable()
export class VoiceMicrophoneService {
  constructor(
    @Inject(VOICE_STATE_REPOSITORY) private readonly state: VoiceStateRepository,
    private readonly media: MediaSessionRegistry,
    private readonly access: MediaRoomAccessService,
    private readonly speaking: SpeakingService,
    private readonly broadcaster: VoiceBroadcaster,
  ) {}

  async create(
    userId: string,
    context: VoiceMediaSessionContext,
    payload: CreateProducerPayload,
  ): Promise<types.Producer> {
    const { mediaRoomId, participant } = context;
    if (!(await this.access.canSpeak(userId, mediaRoomId))) throw new VoiceSpeakForbiddenError();

    const producer = await this.media.createProducer(
      participant.sessionId,
      payload.transportId,
      payload.kind,
      payload.rtpParameters,
      participant.selfMuted || participant.moderatorMuted,
      payload.source,
      payload.screenStreamId ?? null,
    );

    await this.speaking.addProducer(mediaRoomId, userId, producer);
    producer.observer.once("close", () => {
      this.speaking.forgetProducer(mediaRoomId, producer.id);
      this.broadcaster.producerClosed(mediaRoomId, producer.id);
    });
    this.broadcaster.producerCreated(mediaRoomId, {
      userId,
      producerId: producer.id,
      kind: producer.kind,
      source: payload.source,
      screenStreamId: payload.screenStreamId ?? null,
    });

    return producer;
  }

  async closeForUser(userId: string): Promise<void> {
    const channelId = await this.state.channelOf(userId);
    if (!channelId) return;
    const participant = await this.state.participant(channelId, userId);
    if (!participant || !this.media.has(participant.sessionId)) return;

    for (const producer of this.media.producersOfSession(participant.sessionId)) {
      if (producer.source !== "microphone") continue;
      await this.speaking.removeProducer(channelId, producer.producerId);
      this.media.closeProducer(participant.sessionId, producer.producerId);
    }
  }
}
