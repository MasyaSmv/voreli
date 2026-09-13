import type { VoiceInputMode } from "../../entities/voice-settings/voice-settings.store";

const RELEASE_DELAY_MS = 300;

/** Pure owner of the local VAD/PTT gate; browser event wiring lives one layer above it. */
export class VoiceInputGate {
  private value = false;
  private silenceStartedAt: number | null = null;

  get open(): boolean {
    return this.value;
  }

  sample(levelDb: number, thresholdDb: number, enabled: boolean, now: number): boolean {
    if (!enabled) return this.close();
    if (levelDb >= thresholdDb) {
      this.silenceStartedAt = null;
      this.value = true;
      return true;
    }
    if (!this.value) return false;
    this.silenceStartedAt ??= now;
    if (now - this.silenceStartedAt >= RELEASE_DELAY_MS) this.close();
    return this.value;
  }

  keyDown(
    code: string,
    assignedCode: string,
    repeat: boolean,
    editable: boolean,
    enabled: boolean,
  ): boolean {
    if (code !== assignedCode || repeat || editable || !enabled) return false;
    this.silenceStartedAt = null;
    this.value = true;
    return true;
  }

  keyUp(code: string, assignedCode: string): boolean {
    if (code !== assignedCode) return false;
    this.close();
    return true;
  }

  modeChanged(mode: VoiceInputMode): boolean {
    if (mode === "push-to-talk") return this.close();
    return this.value;
  }

  close(): false {
    this.value = false;
    this.silenceStartedAt = null;
    return false;
  }
}
