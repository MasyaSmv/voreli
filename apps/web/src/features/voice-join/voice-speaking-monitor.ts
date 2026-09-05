import { MicrophoneMeter } from "./microphone-meter";
import type { OwnUserId } from "./voice-identity";
import type { VoiceSessionState } from "./voice-state";

/**
 * Decides who the UI shows as speaking: the server's authoritative list of remote speakers,
 * plus immediate local metering for yourself.
 *
 * It also owns the AudioContext, because a context may only be created from a user gesture —
 * `unlockAudio` is called from the click that joins, long before there is any track to meter.
 */
export class VoiceSpeakingMonitor {
  private remoteUserIds: ReadonlySet<string> = new Set();
  private localSpeaking = false;
  private audioContext: AudioContext | undefined;
  private readonly meter = new MicrophoneMeter();

  constructor(
    private readonly state: VoiceSessionState,
    private readonly ownUserId: OwnUserId,
  ) {}

  unlockAudio(): void {
    this.audioContext ??= new window.AudioContext();
    void this.audioContext.resume().catch((error: unknown) => this.state.failed(error));
  }

  closeAudio(): void {
    this.stopMetering();
    if (!this.audioContext) return;
    void this.audioContext.close().catch((error: unknown) => this.state.failed(error));
    this.audioContext = undefined;
  }

  setRemote(userIds: readonly string[]): void {
    this.remoteUserIds = new Set(userIds);
    this.publish();
  }

  observeMicrophone(track: MediaStreamTrack, isEnabled: () => boolean): void {
    if (!this.audioContext) return;
    this.meter.start(this.audioContext, track, isEnabled, (speaking) => {
      this.localSpeaking = speaking;
      this.publish();
    });
  }

  /** Muting has to silence your own bubble at once; the meter would only notice on decay. */
  muteLocal(): void {
    this.localSpeaking = false;
    this.publish();
  }

  stopMetering(): void {
    this.meter.stop();
    this.remoteUserIds = new Set();
    this.localSpeaking = false;
  }

  private publish(): void {
    const speaking = new Set(this.remoteUserIds);
    const ownUserId = this.ownUserId();
    if (ownUserId !== undefined) {
      if (this.localSpeaking) speaking.add(ownUserId);
      else speaking.delete(ownUserId);
    }
    this.state.speaking(speaking);
  }
}
