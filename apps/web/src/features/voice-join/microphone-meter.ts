/** Root-mean-square level above which the local microphone counts as speech. */
const SPEAKING_RMS_THRESHOLD = 0.025;

/** 512 samples at 48 kHz is ~10 ms of audio: short enough to react within one frame. */
const FFT_SIZE = 512;

/**
 * Measures whether the local microphone is currently above the speaking threshold.
 *
 * Split out from VoiceSpeakingMonitor so the part that needs a real Web Audio graph stays
 * apart from the pure question of who the UI shows as speaking — that logic is then testable
 * without an audio device.
 *
 * The level is measured locally instead of waiting for the server's AudioLevelObserver: a
 * round trip is visible as lag on your own avatar, and only your own.
 */
export class MicrophoneMeter {
  private source: MediaStreamAudioSourceNode | undefined;
  private frame: number | undefined;

  start(
    context: AudioContext,
    track: MediaStreamTrack,
    isEnabled: () => boolean,
    onChange: (speaking: boolean) => void,
  ): void {
    this.stop();
    const analyser = context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    this.source = context.createMediaStreamSource(new MediaStream([track]));
    this.source.connect(analyser);

    const samples = new Float32Array(analyser.fftSize);
    let speaking = false;

    const measure = (): void => {
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(
        samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length,
      );
      const next = isEnabled() && rms > SPEAKING_RMS_THRESHOLD;
      if (next !== speaking) {
        speaking = next;
        onChange(next);
      }
      this.frame = requestAnimationFrame(measure);
    };

    measure();
  }

  stop(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.source?.disconnect();
    this.source = undefined;
  }
}
