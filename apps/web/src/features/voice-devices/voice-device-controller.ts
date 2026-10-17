import { useVoiceSettings } from "../../entities/voice-settings/voice-settings.store";
import { i18n } from "../../shared/i18n/i18n";
import type { VoiceInputDevice, VoiceInputTarget } from "./voice-input-device";

export interface VoiceDeviceMedia {
  readonly microphoneServerPaused: boolean;
  readonly outputSelectionSupported: boolean;
  setInputGateOpen(open: boolean): void;
  chooseOutput(preferredDeviceId: string | null): Promise<string | null>;
  useDefaultOutput(): Promise<void>;
  replaceInputTrack(track: MediaStreamTrack): Promise<void>;
}

export interface VoiceDeviceMeter {
  unlockAudio(): void;
  observeMicrophone(track: MediaStreamTrack, isEnabled: () => boolean): void;
  stopMetering(): void;
  closeMicrophoneInput(): void;
}

export interface VoiceDeviceSessionState {
  readonly isActive: boolean;
  failed(error: unknown): void;
}

/** Owns capture, replacement, preview and devicechange reconciliation. */
export class VoiceDeviceController implements VoiceInputTarget {
  /**
   * A session capture is spoken for before the session exists: accepting a call takes the
   * microphone first and joins afterwards, and a join waits its turn in the session queue.
   * Without this mark that capture looks idle to a preview's cleanup, which then stops the
   * track the join is about to produce from.
   */
  private sessionCapture = false;

  constructor(
    private readonly input: VoiceInputDevice,
    private readonly media: VoiceDeviceMedia,
    private readonly meter: VoiceDeviceMeter,
    private readonly state: VoiceDeviceSessionState,
  ) {
    navigator.mediaDevices?.addEventListener("devicechange", () => {
      void this.handleDeviceChange().catch((error: unknown) => {
        console.error("Failed to reconcile changed voice devices", { error });
        this.state.failed(error);
      });
    });
  }

  /** Capture for a session, current or about to be joined; previews use their own path. */
  capture(): Promise<MediaStream> {
    this.sessionCapture = true;
    return this.input.capture(useVoiceSettings.getState().inputDeviceId);
  }

  adopt(stream: MediaStream): MediaStream {
    return this.input.adopt(stream);
  }

  async preview(): Promise<void> {
    this.meter.unlockAudio();
    const stream = await this.input.capture(useVoiceSettings.getState().inputDeviceId);
    const track = stream.getAudioTracks()[0];
    if (track) this.observeInputTrack(track);
  }

  /**
   * Drops a preview capture. A live session keeps its microphone, and so does a session that
   * is still being joined.
   */
  releaseIdleInput(): void {
    if (this.state.isActive || this.sessionCapture) return;
    this.meter.stopMetering();
    this.release();
  }

  /** Drops a capture taken for a session that never came — a call abandoned before it joined. */
  releaseUnusedSessionInput(): void {
    if (this.state.isActive) return;
    this.meter.stopMetering();
    this.release();
  }

  async selectInput(deviceId: string | null): Promise<void> {
    this.meter.unlockAudio();
    useVoiceSettings.getState().setInputError(null);
    try {
      if (this.state.isActive) await this.input.switchTo(deviceId, this);
      else {
        const stream = await this.input.capture(deviceId);
        const track = stream.getAudioTracks()[0];
        if (track) this.observeInputTrack(track);
      }
      useVoiceSettings.getState().update({ inputDeviceId: deviceId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Microphone is unavailable";
      useVoiceSettings.getState().setInputError(message);
      throw error;
    }
  }

  get outputSelectionSupported(): boolean {
    return this.media.outputSelectionSupported;
  }

  async selectOutput(): Promise<void> {
    const settings = useVoiceSettings.getState();
    settings.setOutputWarning(null);
    if (!this.media.outputSelectionSupported) {
      settings.update({ outputDeviceId: null });
      return;
    }
    try {
      const selected = await this.media.chooseOutput(settings.outputDeviceId);
      settings.update({ outputDeviceId: selected });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Audio output is unavailable";
      settings.setOutputWarning(message);
      throw error;
    }
  }

  release(): void {
    this.sessionCapture = false;
    this.input.release();
  }

  replaceInputTrack(track: MediaStreamTrack): Promise<void> {
    return this.media.replaceInputTrack(track);
  }

  observeInputTrack(track: MediaStreamTrack): void {
    this.meter.observeMicrophone(track, () => !this.media.microphoneServerPaused);
  }

  private async handleDeviceChange(): Promise<void> {
    const settings = useVoiceSettings.getState();
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (
      settings.inputDeviceId !== null &&
      !devices.some(
        (device) => device.kind === "audioinput" && device.deviceId === settings.inputDeviceId,
      )
    ) {
      this.media.setInputGateOpen(false);
      try {
        await this.selectInput(null);
      } catch (error: unknown) {
        console.error("Failed to fall back to the default microphone", { error });
        this.input.release();
        this.meter.closeMicrophoneInput();
      }
    }
    if (
      settings.outputDeviceId !== null &&
      !devices.some(
        (device) => device.kind === "audiooutput" && device.deviceId === settings.outputDeviceId,
      )
    ) {
      await this.media.useDefaultOutput();
      settings.update({ outputDeviceId: null });
      settings.setOutputWarning(i18n.t("voice.devices.outputFallback"));
    }
  }
}
