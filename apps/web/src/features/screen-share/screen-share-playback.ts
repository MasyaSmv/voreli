import type { types } from "mediasoup-client";

interface ReceivedScreenMedia {
  readonly producerId: string;
  readonly consumer: types.Consumer;
}

/** Owns the consumers and browser elements for the one screen stream selected by the viewer. */
export class ScreenSharePlayback {
  private readonly received = new Map<string, ReceivedScreenMedia>();
  private audioElement: HTMLAudioElement | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private videoTrack: MediaStreamTrack | null = null;
  private outputDeviceId: string | null = null;

  async replace(consumers: readonly types.Consumer[]): Promise<boolean> {
    this.close();
    let audioStarted = true;
    try {
      for (const consumer of consumers) {
        this.received.set(consumer.producerId, { producerId: consumer.producerId, consumer });
        if (consumer.kind === "video") {
          this.videoTrack = consumer.track;
          await this.attachCurrentVideo();
        } else {
          audioStarted = await this.attachAudio(consumer.track);
        }
      }
    } catch (error: unknown) {
      this.close();
      throw error;
    }
    return audioStarted;
  }

  async attachVideo(element: HTMLVideoElement | null): Promise<void> {
    if (this.videoElement && this.videoElement !== element) {
      this.videoElement.pause();
      this.videoElement.srcObject = null;
    }
    this.videoElement = element;
    await this.attachCurrentVideo();
  }

  async setOutputDevice(outputDeviceId: string | null): Promise<void> {
    this.outputDeviceId = outputDeviceId;
    if (this.audioElement && "setSinkId" in this.audioElement) {
      await this.audioElement.setSinkId(outputDeviceId ?? "");
    }
  }

  async resumeAudio(): Promise<void> {
    await this.audioElement?.play();
  }

  closeProducer(producerId: string): void {
    const received = this.received.get(producerId);
    if (!received) return;
    received.consumer.close();
    this.received.delete(producerId);
    if (received.consumer.kind === "video") {
      this.videoTrack = null;
      if (this.videoElement) {
        this.videoElement.pause();
        this.videoElement.srcObject = null;
      }
    } else {
      this.releaseAudio();
    }
  }

  retain(producerIds: ReadonlySet<string>): void {
    for (const producerId of [...this.received.keys()]) {
      if (!producerIds.has(producerId)) this.closeProducer(producerId);
    }
  }

  close(): void {
    for (const received of this.received.values()) received.consumer.close();
    this.received.clear();
    this.videoTrack = null;
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.srcObject = null;
    }
    this.releaseAudio();
  }

  private async attachCurrentVideo(): Promise<void> {
    if (!this.videoElement || !this.videoTrack) return;
    this.videoElement.srcObject = new MediaStream([this.videoTrack]);
    await this.videoElement.play();
  }

  private async attachAudio(track: MediaStreamTrack): Promise<boolean> {
    this.releaseAudio();
    const element = new Audio();
    element.hidden = true;
    element.srcObject = new MediaStream([track]);
    document.body.append(element);
    this.audioElement = element;
    if (this.outputDeviceId !== null && "setSinkId" in element) {
      await element.setSinkId(this.outputDeviceId);
    }
    try {
      await element.play();
      return true;
    } catch (error: unknown) {
      console.warn("Screen-share audio autoplay was blocked", { error });
      return false;
    }
  }

  private releaseAudio(): void {
    if (!this.audioElement) return;
    this.audioElement.pause();
    this.audioElement.srcObject = null;
    this.audioElement.remove();
    this.audioElement = null;
  }
}
