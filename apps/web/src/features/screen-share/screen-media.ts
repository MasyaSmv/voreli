import type { VoiceProducerView } from "@voreli/shared";
import type { types } from "mediasoup-client";

import { ScreenSharePlayback } from "./screen-share-playback";

export interface ScreenMediaGraph {
  createScreenProducer(
    track: MediaStreamTrack,
    source: "screen-video" | "screen-audio",
    screenStreamId: string,
  ): Promise<types.Producer>;
  createScreenConsumer(producerId: string): Promise<types.Consumer>;
  resumeScreenConsumer(consumerId: string): Promise<null>;
}

export interface ScreenPlayback {
  replace(consumers: readonly types.Consumer[]): Promise<boolean>;
  attachVideo(element: HTMLVideoElement | null): Promise<void>;
  setOutputDevice(outputDeviceId: string | null): Promise<void>;
  resumeAudio(): Promise<void>;
  closeProducer(producerId: string): void;
  retain(producerIds: ReadonlySet<string>): void;
  close(): void;
}

/** Owns remote screen consumers and their browser playback for one voice media graph. */
export class ScreenMedia {
  constructor(
    private readonly graph: ScreenMediaGraph,
    private readonly playback: ScreenPlayback = new ScreenSharePlayback(),
  ) {}

  produce(
    track: MediaStreamTrack,
    source: "screen-video" | "screen-audio",
    screenStreamId: string,
  ): Promise<types.Producer> {
    return this.graph.createScreenProducer(track, source, screenStreamId);
  }

  async watch(producers: readonly VoiceProducerView[]): Promise<boolean> {
    const consumers: types.Consumer[] = [];
    try {
      for (const producer of producers) {
        consumers.push(await this.graph.createScreenConsumer(producer.producerId));
      }
      const audioStarted = await this.playback.replace(consumers);
      await Promise.all(consumers.map((consumer) => this.graph.resumeScreenConsumer(consumer.id)));
      return audioStarted;
    } catch (error: unknown) {
      consumers.forEach((consumer) => consumer.close());
      this.playback.close();
      throw error;
    }
  }

  attachVideo(element: HTMLVideoElement | null): Promise<void> {
    return this.playback.attachVideo(element);
  }

  setOutputDevice(outputDeviceId: string | null): Promise<void> {
    return this.playback.setOutputDevice(outputDeviceId);
  }

  resumeAudio(): Promise<void> {
    return this.playback.resumeAudio();
  }

  closeProducer(producerId: string): void {
    this.playback.closeProducer(producerId);
  }

  retain(producerIds: ReadonlySet<string>): void {
    this.playback.retain(producerIds);
  }

  close(): void {
    this.playback.close();
  }
}
