import { Inject, Injectable } from "@nestjs/common";

import { VoiceSessionNotFoundError } from "./errors/voice-media-errors.js";
import { MediaSessionRegistry } from "./media-session.registry.js";
import {
  VOICE_STATE_REPOSITORY,
  type VoiceParticipantState,
  type VoiceStateRepository,
} from "./voice-state.repository.js";

export interface VoiceMediaSessionContext {
  readonly mediaRoomId: string;
  readonly participant: VoiceParticipantState;
}

@Injectable()
export class VoiceMediaSessionContextService {
  constructor(
    @Inject(VOICE_STATE_REPOSITORY) private readonly state: VoiceStateRepository,
    private readonly media: MediaSessionRegistry,
  ) {}

  async resolve(
    userId: string,
    authenticationSessionId: string,
  ): Promise<VoiceMediaSessionContext> {
    const mediaRoomId = await this.state.channelOf(userId);
    if (!mediaRoomId) throw new VoiceSessionNotFoundError();
    const participant = await this.state.participant(mediaRoomId, userId);
    if (
      !participant ||
      participant.authenticationSessionId !== authenticationSessionId ||
      !this.media.has(participant.sessionId)
    ) {
      throw new VoiceSessionNotFoundError();
    }
    return { mediaRoomId, participant };
  }
}
