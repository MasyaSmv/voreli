import { MicrophoneMeter } from "./microphone-meter";
import { RemoteSpeakingHold } from "./remote-speaking-hold";
import type { OwnUserId } from "./voice-identity";
import type { VoiceSessionState } from "./voice-state";
import { i18n } from "../../shared/i18n/i18n";
import { useVoiceSettings } from "../../entities/voice-settings/voice-settings.store";
import { VoiceInputGate } from "../voice-input/voice-input-gate";

/**
 * How long a started meter may produce nothing before the gate is opened anyway. A suspended
 * AudioContext does not run its graph and does not report that it refused to: no samples
 * arrive, and nothing would ever open the voice-activity gate.
 */
const METER_SILENCE_TIMEOUT_MS = 1_500;

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
  private meterWatchdog: number | undefined;

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
    // Without a meter nothing will ever open the voice-activity gate, and a producer that
    // stays paused forever is silence the person cannot see a reason for. Being heard when
    // the gate should have held is the better of the two failures, so the gate opens.
    if (!this.audioContext) {
      this.openGateWithoutMeter();
      return;
    }

    this.armMeterWatchdog();
    this.meter.start(this.audioContext, track, isEnabled, (levelDb, speaking) => {
      this.clearMeterWatchdog();
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
    this.clearMeterWatchdog();
    this.meter.stop();
    this.localSpeaking = false;
    useVoiceSettings.getState().setMicrophoneLevel(-100);
    this.closeInputGate();
    this.publish();
  }

  private openGateWithoutMeter(): void {
    this.media.setInputGateOpen(true);
    useVoiceSettings.getState().setInputError(i18n.t("voice.devices.meterUnavailable"));
  }

  private armMeterWatchdog(): void {
    this.clearMeterWatchdog();
    this.meterWatchdog = window.setTimeout(() => {
      this.meterWatchdog = undefined;
      this.openGateWithoutMeter();
    }, METER_SILENCE_TIMEOUT_MS);
  }

  private clearMeterWatchdog(): void {
    if (this.meterWatchdog === undefined) return;
    window.clearTimeout(this.meterWatchdog);
    this.meterWatchdog = undefined;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const settings = useVoiceSettings.getState();
    // The listener lives as long as the page, so outside a session the assigned key belongs
    // to the rest of the app and must not be swallowed here.
    if (settings.inputMode !== "push-to-talk" || !this.state.isConnected) return;
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
    if (settings.inputMode !== "push-to-talk" || !this.state.isConnected) return;
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
