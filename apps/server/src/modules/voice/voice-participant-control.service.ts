import { Inject, Injectable, Logger } from "@nestjs/common";
import type {
  SetVoiceModeratorStatePayload,
  SetVoiceSelfStatePayload,
  VoiceParticipantView,
} from "@voreli/shared";

import { VoiceSessionNotFoundError } from "./errors/voice-media-errors.js";
import { VoiceModerationTargetNotPresentError } from "./errors/voice-room-errors.js";
import { MediaSessionRegistry } from "./media-session.registry.js";
import { VoiceBroadcaster } from "./voice-broadcaster.js";
import { VoiceModerationPolicy } from "./voice-moderation.policy.js";
import {
  VOICE_STATE_REPOSITORY,
  type VoiceControlState,
  type VoiceParticipantState,
  type VoiceStateRepository,
} from "./voice-state.repository.js";

@Injectable()
export class VoiceParticipantControlService {
  private readonly logger = new Logger(VoiceParticipantControlService.name);
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    @Inject(VOICE_STATE_REPOSITORY) private readonly state: VoiceStateRepository,
    private readonly media: MediaSessionRegistry,
    private readonly broadcaster: VoiceBroadcaster,
    private readonly moderation: VoiceModerationPolicy,
  ) {}

  async setSelfState(
    userId: string,
    authenticationSessionId: string,
    payload: SetVoiceSelfStatePayload,
  ): Promise<VoiceParticipantView> {
    const channelId = await this.state.channelOf(userId);
    if (!channelId) throw new VoiceSessionNotFoundError();

    return this.serialize(channelId, userId, async () => {
      const before = await this.activeParticipant(channelId, userId, authenticationSessionId);
      return this.apply(channelId, before, {
        selfMuted: payload.selfMuted,
        selfDeafened: payload.selfDeafened,
        moderatorMuted: before.moderatorMuted,
        moderatorDeafened: before.moderatorDeafened,
      });
    });
  }

  setModeratorState(
    actorId: string,
    payload: SetVoiceModeratorStatePayload,
  ): Promise<VoiceParticipantView> {
    return this.serialize(payload.channelId, payload.userId, async () => {
      const before = await this.state.participant(payload.channelId, payload.userId);
      if (!before || !this.media.has(before.sessionId)) {
        throw new VoiceModerationTargetNotPresentError(payload.userId);
      }
      await this.moderation.assertAllowed(actorId, payload, before);
      return this.apply(payload.channelId, before, {
        selfMuted: before.selfMuted,
        selfDeafened: before.selfDeafened,
        moderatorMuted: payload.moderatorMuted,
        moderatorDeafened: payload.moderatorDeafened,
      });
    });
  }

  private async apply(
    channelId: string,
    before: VoiceParticipantState,
    control: VoiceControlState,
  ): Promise<VoiceParticipantView> {
    const participant = await this.state.updateControlState(
      channelId,
      before.userId,
      before.sessionId,
      before.generation,
      control,
    );
    if (!participant) throw new VoiceSessionNotFoundError();

    try {
      await this.applyMedia(participant);
    } catch (error: unknown) {
      try {
        const restored = await this.state.updateControlState(
          channelId,
          before.userId,
          before.sessionId,
          before.generation,
          this.controlOf(before),
        );
        if (!restored) throw new VoiceSessionNotFoundError();
        await this.applyMedia(restored);
      } catch (rollbackError: unknown) {
        this.logger.error({
          message: "Failed to roll back voice participant control state",
          error: rollbackError,
          originalError: error,
          channelId,
          userId: before.userId,
          operation: "rollbackVoiceParticipantControl",
        });
      }
      throw error;
    }

    const view = this.view(participant);
    this.broadcaster.participantUpdated(channelId, view);
    return view;
  }

  private async activeParticipant(
    channelId: string,
    userId: string,
    authenticationSessionId: string,
  ): Promise<VoiceParticipantState> {
    const participant = await this.state.participant(channelId, userId);
    if (
      !participant ||
      participant.authenticationSessionId !== authenticationSessionId ||
      !this.media.has(participant.sessionId)
    ) {
      throw new VoiceSessionNotFoundError();
    }
    return participant;
  }

  private applyMedia(participant: VoiceParticipantState): Promise<readonly [void, void]> {
    return Promise.all([
      this.media.setProducerPaused(
        participant.sessionId,
        participant.selfMuted || participant.moderatorMuted,
      ),
      this.media.setConsumersPaused(
        participant.sessionId,
        participant.selfDeafened || participant.moderatorDeafened,
      ),
    ]);
  }

  private controlOf(participant: VoiceParticipantState): VoiceControlState {
    return {
      selfMuted: participant.selfMuted,
      selfDeafened: participant.selfDeafened,
      moderatorMuted: participant.moderatorMuted,
      moderatorDeafened: participant.moderatorDeafened,
    };
  }

  private view(participant: VoiceParticipantState): VoiceParticipantView {
    return {
      userId: participant.userId,
      ...this.controlOf(participant),
      producers: this.media.producersOfSession(participant.sessionId),
    };
  }

  private serialize<T>(channelId: string, userId: string, operation: () => Promise<T>): Promise<T> {
    const key = `${channelId}\u0000${userId}`;
    const previous = this.queues.get(key) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(key, tail);
    void tail.finally(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return result;
  }
}
