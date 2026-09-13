const ENTRY_RMS_THRESHOLD = 0.03;
const EXIT_RMS_THRESHOLD = 0.018;
const ATTACK_SAMPLE_COUNT = 3;
const RELEASE_DELAY_MS = 300;

/** Pure local speech detector: attack filters spikes, hysteresis and release filter chatter. */
export class SpeakingDetector {
  private loudSamples = 0;
  private silenceStartedAt: number | null = null;
  private value = false;

  get speaking(): boolean {
    return this.value;
  }

  sample(rms: number, enabled: boolean, now: number): boolean {
    if (!enabled) {
      this.reset();

      return false;
    }

    if (!this.value) {
      this.loudSamples = rms >= ENTRY_RMS_THRESHOLD ? this.loudSamples + 1 : 0;
      if (this.loudSamples >= ATTACK_SAMPLE_COUNT) {
        this.value = true;
        this.silenceStartedAt = null;
      }

      return this.value;
    }

    if (rms >= EXIT_RMS_THRESHOLD) {
      this.silenceStartedAt = null;

      return true;
    }

    this.silenceStartedAt ??= now;
    if (now - this.silenceStartedAt >= RELEASE_DELAY_MS) this.reset();

    return this.value;
  }

  reset(): void {
    this.loudSamples = 0;
    this.silenceStartedAt = null;
    this.value = false;
  }
}
