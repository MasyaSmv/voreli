import { MicrophoneMeter } from "./microphone-meter";
import { RemoteSpeakingHold } from "./remote-speaking-hold";
import type { OwnUserId } from "./voice-identity";
import type { VoiceSessionState } from "./voice-state";
import { useVoiceSettings } from "../../entities/voice-settings/voice-settings.store";
import { VoiceInputGate } from "../voice-input/voice-input-gate";

export interface LocalVoiceInputGate {
  readonly microphoneServerPaused: boolean;
  setInputGateOpen(open: boolean): void;
}

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
  private readonly inputGate = new VoiceInputGate();

  constructor(
    private readonly state: VoiceSessionState,
    private readonly ownUserId: OwnUserId,
    private readonly media: LocalVoiceInputGate,
  ) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.closeInputGate);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    useVoiceSettings.subscribe((settings, previous) => {
      if (settings.inputMode !== previous.inputMode) {
        this.media.setInputGateOpen(this.inputGate.modeChanged(settings.inputMode));
      }
    });
  }

  unlockAudio(): void {
    this.audioContext ??= new window.AudioContext();
    void this.audioContext.resume().catch((error: unknown) => this.state.failed(error));
  }

  closeAudio(): void {
    this.stopMetering();
    if (!this.audioContext) return;
    void this.audioContext.close().catch((error: unknown) => {
      console.error("Failed to close the microphone AudioContext", { error });
      this.state.failed(error);
    });
    this.audioContext = undefined;
  }

  closeMicrophoneInput(): void {
    this.stopMicrophoneMetering();
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
    this.meter.start(this.audioContext, track, isEnabled, (levelDb, speaking) => {
      const settings = useVoiceSettings.getState();
      settings.setMicrophoneLevel(levelDb);
      if (settings.inputMode === "voice-activity") {
        this.media.setInputGateOpen(
          this.inputGate.sample(
            levelDb,
            settings.voiceActivityThresholdDb,
            isEnabled(),
            performance.now(),
          ),
        );
      }
      this.localSpeaking = speaking;
      this.publish();
    });
  }

  /** Muting has to silence your own bubble at once; the meter would only notice on decay. */
  muteLocal(): void {
    this.meter.reset();
    this.localSpeaking = false;
    this.closeInputGate();
    this.publish();
  }

  stopMetering(): void {
    this.stopMicrophoneMetering();
    if (this.remoteExpiryTimer !== undefined) window.clearTimeout(this.remoteExpiryTimer);
    this.remoteExpiryTimer = undefined;
    this.remoteHold.clear();
    this.remoteUserIds = new Set();
    this.localSpeaking = false;
    this.publish();
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

  private stopMicrophoneMetering(): void {
    this.meter.stop();
    this.localSpeaking = false;
    useVoiceSettings.getState().setMicrophoneLevel(-100);
    this.closeInputGate();
    this.publish();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const settings = useVoiceSettings.getState();
    if (settings.inputMode !== "push-to-talk") return;
    const handled = this.inputGate.keyDown(
      event.code,
      settings.pushToTalkCode,
      event.repeat,
      isEditable(event.target),
      !this.media.microphoneServerPaused,
    );
    if (handled) {
      event.preventDefault();
      this.media.setInputGateOpen(true);
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const settings = useVoiceSettings.getState();
    if (settings.inputMode !== "push-to-talk") return;
    if (this.inputGate.keyUp(event.code, settings.pushToTalkCode)) {
      event.preventDefault();
      this.media.setInputGateOpen(false);
    }
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") this.closeInputGate();
  };

  private readonly closeInputGate = (): void => {
    this.inputGate.close();
    this.media.setInputGateOpen(false);
  };
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}
