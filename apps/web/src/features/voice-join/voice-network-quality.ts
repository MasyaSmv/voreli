import type { CallConnectionQuality } from "@voreli/shared";
import type { types } from "mediasoup-client";

const BITRATES: Readonly<Record<Exclude<CallConnectionQuality, "unknown">, number>> = {
  good: 24_000,
  constrained: 16_000,
  poor: 12_000,
};
type MeasuredQuality = Exclude<CallConnectionQuality, "unknown">;

export interface NetworkSample {
  readonly loss: number;
  readonly rttMs: number;
}

export class VoiceQualitySmoother {
  private current: CallConnectionQuality = "unknown";
  private worseSamples = 0;
  private betterSince: number | null = null;

  add(sample: NetworkSample, now: number): MeasuredQuality | null {
    const measured = classifyNetwork(sample);
    if (this.current === "unknown") {
      this.current = measured;
      return measured;
    }

    const measuredRank = qualityRank(measured);
    const currentRank = qualityRank(this.current);
    if (measuredRank > currentRank) {
      this.betterSince = null;
      this.worseSamples += 1;
      if (this.worseSamples < 2) return null;
      this.worseSamples = 0;
      this.current = measured;
      return measured;
    }

    this.worseSamples = 0;
    if (measuredRank === currentRank) {
      this.betterSince = null;
      return null;
    }

    this.betterSince ??= now;
    if (now - this.betterSince < 10_000) return null;
    this.betterSince = null;
    this.current = measured;
    return measured;
  }
}

export function classifyNetwork(sample: NetworkSample): MeasuredQuality {
  if (sample.loss >= 0.05 || sample.rttMs >= 600) return "poor";
  if (sample.loss >= 0.02 || sample.rttMs >= 300) return "constrained";
  return "good";
}

export function observeProducerQuality(
  producer: types.Producer,
  onQuality: (quality: CallConnectionQuality) => void,
): () => void {
  const smoother = new VoiceQualitySmoother();
  let stopped = false;
  let running = false;

  const sample = async (): Promise<void> => {
    if (stopped || running || producer.closed) return;
    running = true;
    try {
      const measured = extractNetworkSample(await producer.getStats());
      if (!measured) {
        onQuality("unknown");
        return;
      }
      const quality = smoother.add(measured, Date.now());
      if (!quality) return;
      await producer.setRtpEncodingParameters({ maxBitrate: BITRATES[quality] });
      onQuality(quality);
    } catch (error: unknown) {
      console.error("Failed to measure or adapt voice network quality", error);
      onQuality("unknown");
    } finally {
      running = false;
    }
  };

  void sample();
  const timer = setInterval(() => void sample(), 2_000);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export function extractNetworkSample(stats: RTCStatsReport): NetworkSample | null {
  for (const value of stats.values()) {
    const report = value as RTCStats & { fractionLost?: unknown; roundTripTime?: unknown };
    if (
      report.type === "remote-inbound-rtp" &&
      typeof report.fractionLost === "number" &&
      typeof report.roundTripTime === "number"
    ) {
      return { loss: report.fractionLost, rttMs: report.roundTripTime * 1_000 };
    }
  }
  return null;
}

function qualityRank(quality: CallConnectionQuality): number {
  if (quality === "poor") return 2;
  if (quality === "constrained") return 1;
  return 0;
}
