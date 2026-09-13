import { Inject, Injectable, Logger } from "@nestjs/common";
import type {
  SetVoiceModeratorStatePayload,
  SetVoiceSelfStatePayload,
  VoiceParticipantView,
} from "@voreli/shared";

import { VoiceSessionNotFoundError } from "./errors/voice-media-errors.js";
import {
  VoiceModerationStateChangedError,
  VoiceModerationTargetNotPresentError,
} from "./errors/voice-room-errors.js";
import { MediaSessionRegistry } from "./media-session.registry.js";
import { VoiceBroadcaster } from "./voice-broadcaster.js";
import { VoiceModerationPolicy } from "./voice-moderation.policy.js";
import {
  VOICE_STATE_REPOSITORY,
  type VoiceModeratorControlState,
  type VoiceParticipantState,
  type VoiceStateRepository,
} from "./voice-state.repository.js";

/**
 * The single writer of a voice participant's mute and deafen state.
 *
 * Self and moderator flags live in one record but are never written as one snapshot: each
 * command writes only the half it owns, so a self toggle and a moderator toggle racing from
 * two instances cannot erase each other. The in-process queue only spares the common case a
 * wasted round trip; correctness rests on the repository, not on the queue.
 */
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
      const updated = await this.state.updateSelfState(
        channelId,
        userId,
        before.sessionId,
        before.generation,
        { selfMuted: payload.selfMuted, selfDeafened: payload.selfDeafened },
      );
      if (!updated) throw new VoiceSessionNotFoundError();

      return this.applyMediaOrRollback(channelId, updated, () =>
        this.state.updateSelfState(channelId, userId, before.sessionId, before.generation, {
          selfMuted: before.selfMuted,
          selfDeafened: before.selfDeafened,
        }),
      );
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

      // Which permission this command needs was decided from `expected`, so the write is
      // refused if either flag moved meanwhile: the decision was made about a state that no
      // longer exists, and applying it anyway would skip the check the new state requires.
      const expected = this.moderatorOf(before);
      const next: VoiceModeratorControlState = {
        moderatorMuted: payload.moderatorMuted,
        moderatorDeafened: payload.moderatorDeafened,
      };
      const updated = await this.state.updateModeratorState(
        payload.channelId,
        payload.userId,
        before.sessionId,
        before.generation,
        expected,
        next,
      );
      if (!updated) throw new VoiceModerationStateChangedError(payload.userId);

      return this.applyMediaOrRollback(payload.channelId, updated, () =>
        this.state.updateModeratorState(
          payload.channelId,
          payload.userId,
          before.sessionId,
          before.generation,
          next,
          expected,
        ),
      );
    });
  }

  /**
   * Redis has accepted the change by the time this runs; if mediasoup then refuses, the
   * stored state is put back so the two cannot disagree. A failed rollback is the one thing
   * nobody can repair from the outside later, so it is logged with both errors.
   */
  private async applyMediaOrRollback(
    channelId: string,
    participant: VoiceParticipantState,
    rollback: () => Promise<VoiceParticipantState | null>,
  ): Promise<VoiceParticipantView> {
    try {
      await this.applyMedia(participant);
    } catch (error: unknown) {
      try {
        const restored = await rollback();
        if (!restored) throw new VoiceSessionNotFoundError();
        await this.applyMedia(restored);
      } catch (rollbackError: unknown) {
        this.logger.error({
          message: "Failed to roll back voice participant control state",
          error: rollbackError,
          originalError: error,
          channelId,
          userId: participant.userId,
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

  private moderatorOf(participant: VoiceParticipantState): VoiceModeratorControlState {
    return {
      moderatorMuted: participant.moderatorMuted,
      moderatorDeafened: participant.moderatorDeafened,
    };
  }

  private view(participant: VoiceParticipantState): VoiceParticipantView {
    return {
      userId: participant.userId,
      selfMuted: participant.selfMuted,
      selfDeafened: participant.selfDeafened,
      ...this.moderatorOf(participant),
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
