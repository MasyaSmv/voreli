import { MicrophoneMeter } from "./microphone-meter";
import { RemoteSpeakingHold } from "./remote-speaking-hold";
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
  private remoteExpiryTimer: number | undefined;
  private localSpeaking = false;
  private audioContext: AudioContext | undefined;
  private readonly meter = new MicrophoneMeter();
  private readonly remoteHold = new RemoteSpeakingHold();

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
    const now = Date.now();
    this.remoteUserIds = this.remoteHold.report(userIds, now);
    this.scheduleRemoteExpiry(now);
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
    this.meter.reset();
    this.localSpeaking = false;
    this.publish();
  }

  stopMetering(): void {
    this.meter.stop();
    if (this.remoteExpiryTimer !== undefined) window.clearTimeout(this.remoteExpiryTimer);
    this.remoteExpiryTimer = undefined;
    this.remoteHold.clear();
    this.remoteUserIds = new Set();
    this.localSpeaking = false;
  }

  private scheduleRemoteExpiry(now: number): void {
    if (this.remoteExpiryTimer !== undefined) window.clearTimeout(this.remoteExpiryTimer);
    const expiry = this.remoteHold.nextExpiry();
    if (expiry === null) {
      this.remoteExpiryTimer = undefined;

      return;
    }

    this.remoteExpiryTimer = window.setTimeout(
      () => {
        const current = Date.now();
        this.remoteUserIds = this.remoteHold.expire(current);
        this.publish();
        this.scheduleRemoteExpiry(current);
      },
      Math.max(1, expiry - now),
    );
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
