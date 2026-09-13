import {
  type CallConnectionQuality,
  type SetVoiceSelfStatePayload,
  type VoiceParticipantUpdatedEvent,
  type SetVoiceModeratorStatePayload,
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
import { VoiceInputDevice } from "../voice-devices/voice-input-device";
import { VoiceDeviceController } from "../voice-devices/voice-device-controller";

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
  private readonly media = new VoiceMedia(this.signaling, this.state, sessionUserId);
  private readonly input = new VoiceInputDevice();
  private readonly speaking = new VoiceSpeakingMonitor(this.state, sessionUserId, this.media);
  private readonly devices = new VoiceDeviceController(
    this.input,
    this.media,
    this.speaking,
    this.state,
  );
  private readonly connection = new VoiceConnection(
    this.signaling,
    this.state,
    this.media,
    this.speaking,
    this.devices,
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
    if (this.state.channelId === channelId && this.state.isConnected) return Promise.resolve();
    // The AudioContext and the microphone prompt both need the user gesture that is still on
    // the stack right now; asking for them after the first await would be too late.
    this.speaking.unlockAudio();
    const microphone = this.devices.capture();
    void microphone.catch((error: unknown) => {
      console.error("Failed to capture the voice microphone", { error });
      this.state.failed(error);
    });
    return this.run(() => this.connection.join(channelId, microphone));
  }

  joinMediaRoom(mediaRoomId: string, preparedMicrophone?: Promise<MediaStream>): Promise<void> {
    if (this.state.channelId === mediaRoomId && this.state.isConnected) {
      if (preparedMicrophone) {
        void preparedMicrophone
          .then((stream) => stream.getTracks().forEach((track) => track.stop()))
          .catch((error: unknown) => {
            console.error("Failed to dispose duplicate prepared microphone", { error });
          });
      }
      return Promise.resolve();
    }
    this.speaking.unlockAudio();
    const microphone = preparedMicrophone
      ? preparedMicrophone.then((stream) => this.devices.adopt(stream))
      : this.devices.capture();
    void microphone.catch((error: unknown) => {
      console.error("Failed to prepare the media-room microphone", { error });
      this.state.failed(error);
    });
    return this.run(() => this.connection.join(mediaRoomId, microphone, "media-room"));
  }

  unlockAudio(): void {
    this.speaking.unlockAudio();
  }

  leave(): Promise<void> {
    return this.serial(async () => {
      try {
        if (this.state.channelId !== null && this.signaling.connected) {
          await this.signaling.request<null>(VoiceClientEvent.Leave, {});
        }
      } finally {
        this.connection.shutdown({ clearError: true });
      }
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

  setModeratorState(payload: SetVoiceModeratorStatePayload): Promise<void> {
    return this.run(async () => {
      const response = await this.signaling.request<VoiceParticipantUpdatedEvent>(
        VoiceClientEvent.SetModeratorState,
        payload,
      );
      this.state.upsertParticipant(response.participant);
    });
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

  async previewMicrophone(): Promise<void> {
    await this.devices.preview();
  }

  stopMicrophonePreview(): void {
    this.devices.stopPreview();
  }

  async selectInputDevice(deviceId: string | null): Promise<void> {
    await this.devices.selectInput(deviceId);
  }

  get outputSelectionSupported(): boolean {
    return this.devices.outputSelectionSupported;
  }

  async selectOutputDevice(): Promise<void> {
    await this.devices.selectOutput();
  }

  observeNetworkQuality(onQuality: (quality: CallConnectionQuality) => void): () => void {
    return this.media.observeQuality((quality) => {
      this.media.setJitterBufferTarget(quality);
      onQuality(quality);
    });
  }

  /**
   * The server is told first: it owns the participant state everyone else sees, and local
   * media must not go quiet on a change the server refused.
   */
  private async setSelfState(state: SetVoiceSelfStatePayload): Promise<void> {
    await this.signaling.request<null>(VoiceClientEvent.SetSelfState, state);
    const own = this.self();
    this.media.setMuted(state.selfMuted || (own?.moderatorMuted ?? false));
    if (state.selfMuted) this.speaking.muteLocal();
    await this.media.setDeafened(state.selfDeafened || (own?.moderatorDeafened ?? false));
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
    this.transition = next.catch((error: unknown) => {
      console.error("Voice session transition failed", { error });
    });
    return next;
  }
}

export const voiceSession = new VoiceSession();
