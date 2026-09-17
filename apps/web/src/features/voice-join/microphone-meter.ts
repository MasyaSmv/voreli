import { SpeakingDetector } from "./speaking-detector";

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
  private readonly detector = new SpeakingDetector();

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
    this.detector.reset();

    const measure = (): void => {
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(
        samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length,
      );
      const speaking = this.detector.speaking;
      const next = this.detector.sample(rms, isEnabled(), performance.now());
      if (next !== speaking) {
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
    this.detector.reset();
  }

  reset(): void {
    this.detector.reset();
  }
}
