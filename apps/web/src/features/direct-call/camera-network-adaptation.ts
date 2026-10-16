import type { CallConnectionQuality } from "@voreli/shared";

import type { CameraProducer } from "./camera-media";

export interface CameraPauseIndicator {
  cameraNetworkPaused(paused: boolean): void;
}

/** What the publication tells the adaptation; narrow so the publication cannot set quality. */
export interface CameraAdaptation {
  publish(producer: CameraProducer): Promise<void>;
  release(): void;
}

/**
 * Keeps the camera inside what the network can carry, so audio survives a bad link.
 *
 * Poor quality pauses the producer outright; anything else caps the bitrate and resumes.
 * The quality is remembered while no camera is on, so a camera started on a bad link starts
 * paused. A newer quality report always wins over an older one still awaiting its bitrate
 * change — that is what the generation counter is for.
 */
export class CameraNetworkAdaptation implements CameraAdaptation {
  private quality: CallConnectionQuality = "unknown";
  private generation = 0;
  private producer: CameraProducer | null = null;

  constructor(private readonly indicator: CameraPauseIndicator) {}

  /** The publication's producer, handed over once it is live; apply the known quality to it. */
  publish(producer: CameraProducer): Promise<void> {
    this.producer = producer;
    return this.setQuality(this.quality);
  }

  release(): void {
    this.producer = null;
  }

  async setQuality(quality: CallConnectionQuality): Promise<void> {
    this.quality = quality;
    const generation = ++this.generation;
    const producer = this.producer;
    if (!producer || producer.closed) return;
    if (quality === "poor") {
      producer.pause();
      this.indicator.cameraNetworkPaused(true);
      return;
    }
    await producer.setRtpEncodingParameters({
      maxBitrate: quality === "good" ? 500_000 : 200_000,
    });
    if (producer.closed || this.producer !== producer || generation !== this.generation) return;
    producer.resume();
    this.indicator.cameraNetworkPaused(false);
  }
}
