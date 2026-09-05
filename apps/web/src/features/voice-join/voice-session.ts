import {
  type SetVoiceSelfStatePayload,
  VoiceClientEvent,
  type VoiceParticipantView,
} from "@voreli/shared";

import { VoiceConnection } from "./voice-connection";
import { sessionUserId } from "./voice-identity";
import { VoiceMedia } from "./voice-media";
import { bindVoiceServerEvents } from "./voice-server-events";
import { SocketVoiceSignaling } from "./voice-signaling";
import { VoiceSpeakingMonitor } from "./voice-speaking-monitor";
import { VoiceSessionState } from "./voice-state";

/**
 * The one object the UI talks to: every command a person can issue on a voice session.
 *
 * It keeps no state of its own — the store, through VoiceSessionState, is the only truth —
 * and its single real job is the queue. Transitions run one at a time so that a leave landing
 * mid-join cannot close transports the join is still building.
 */
class VoiceSession {
  private readonly signaling = new SocketVoiceSignaling();
  private readonly state = new VoiceSessionState();
  private readonly speaking = new VoiceSpeakingMonitor(this.state, sessionUserId);
  private readonly media = new VoiceMedia(this.signaling, this.state, sessionUserId);
  private readonly connection = new VoiceConnection(
    this.signaling,
    this.state,
    this.media,
    this.speaking,
  );
  private transition: Promise<void> = Promise.resolve();

  constructor() {
    bindVoiceServerEvents(this.signaling, {
      state: this.state,
      media: this.media,
      speaking: this.speaking,
      lifecycle: {
        reconnect: () => {
          void this.serial(() => this.connection.resume()).catch((error: unknown) =>
            this.state.failed(error),
          );
        },
        forceLeave: () => this.connection.shutdown(),
      },
    });
  }

  join(channelId: string): Promise<void> {
    // The AudioContext and the microphone prompt both need the user gesture that is still on
    // the stack right now; asking for them after the first await would be too late.
    this.speaking.unlockAudio();
    const microphone = navigator.mediaDevices.getUserMedia({ audio: true });
    void microphone.catch((error: unknown) => this.state.failed(error));
    return this.run(() => this.connection.join(channelId, microphone));
  }

  leave(): Promise<void> {
    return this.serial(async () => {
      if (this.state.channelId !== null && this.signaling.connected) {
        await this.signaling.request<null>(VoiceClientEvent.Leave, {});
      }
      this.connection.shutdown({ clearError: true });
    });
  }

  setSelfMuted(selfMuted: boolean): Promise<void> {
    return this.run(() =>
      this.setSelfState({ selfMuted, selfDeafened: this.self()?.selfDeafened ?? false }),
    );
  }

  setSelfDeafened(selfDeafened: boolean): Promise<void> {
    return this.run(() =>
      this.setSelfState({ selfMuted: this.self()?.selfMuted ?? false, selfDeafened }),
    );
  }

  /** Autoplay blocks playback until a gesture; this is that gesture retrying it. */
  resumeAudio(): Promise<void> {
    this.speaking.unlockAudio();
    return this.run(async () => {
      await this.media.resumeAudio();
      this.state.clearError();
    });
  }

  startEcho(): Promise<void> {
    this.speaking.unlockAudio();
    return this.run(() => this.media.startEcho());
  }

  /**
   * The server is told first: it owns the participant state everyone else sees, and local
   * media must not go quiet on a change the server refused.
   */
  private async setSelfState(state: SetVoiceSelfStatePayload): Promise<void> {
    await this.signaling.request<null>(VoiceClientEvent.SetSelfState, state);
    this.media.setMuted(state.selfMuted);
    if (state.selfMuted) this.speaking.muteLocal();
    await this.media.setDeafened(state.selfDeafened);
  }

  private self(): VoiceParticipantView | undefined {
    return this.state.participant(sessionUserId());
  }

  /** Public entry points report their own failure and still reject, so callers can react. */
  private run(work: () => Promise<void>): Promise<void> {
    return this.serial(work).catch((error: unknown) => {
      this.state.failed(error);
      throw error;
    });
  }

  private serial(work: () => Promise<void>): Promise<void> {
    const next = this.transition.then(work, work);
    this.transition = next.catch(() => undefined);
    return next;
  }
}

export const voiceSession = new VoiceSession();
