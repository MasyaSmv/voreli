import type { types } from "mediasoup-client";

interface ReceivedAudio {
  readonly consumer: types.Consumer;
  readonly element: HTMLAudioElement;
}

/**
 * Owns one hidden <audio> element per remote producer.
 *
 * An element per stream rather than one mixed output: the browser then does its own
 * per-stream buffering, and deafening or dropping a single speaker costs nothing.
 */
export class VoicePlayback {
  private readonly received = new Map<string, ReceivedAudio>();
  private outputDeviceId: string | null = null;

  get outputSelectionSupported(): boolean {
    return Boolean(
      navigator.mediaDevices &&
      "selectAudioOutput" in navigator.mediaDevices &&
      "setSinkId" in HTMLMediaElement.prototype,
    );
  }

  has(producerId: string): boolean {
    return this.received.has(producerId);
  }

  async add(producerId: string, consumer: types.Consumer, deafened: boolean): Promise<void> {
    const element = new Audio();
    element.hidden = true;
    element.dataset["producerId"] = producerId;
    element.srcObject = new MediaStream([consumer.track]);
    document.body.append(element);
    this.received.set(producerId, { consumer, element });

    if (this.outputDeviceId !== null) await element.setSinkId(this.outputDeviceId);

    if (!deafened) await element.play();
  }

  async setDeafened(deafened: boolean): Promise<void> {
    for (const received of this.received.values()) {
      if (deafened) received.element.pause();
      else await received.element.play();
    }
  }

  setJitterBufferTarget(targetMs: number | null): void {
    for (const { consumer } of this.received.values()) {
      const receiver = consumer.rtpReceiver as
        (RTCRtpReceiver & { jitterBufferTarget?: number | null }) | undefined;
      if (receiver && "jitterBufferTarget" in receiver) receiver.jitterBufferTarget = targetMs;
    }
  }

  async chooseOutput(preferredDeviceId: string | null): Promise<string | null> {
    if (!this.outputSelectionSupported) return null;
    const devices = navigator.mediaDevices as MediaDevices & {
      selectAudioOutput(options?: { readonly deviceId?: string }): Promise<MediaDeviceInfo>;
    };
    const selected = await devices.selectAudioOutput(
      preferredDeviceId === null ? undefined : { deviceId: preferredDeviceId },
    );
    await Promise.all(
      [...this.received.values()].map(({ element }) => element.setSinkId(selected.deviceId)),
    );
    this.outputDeviceId = selected.deviceId;
    return selected.deviceId;
  }

  async useDefaultOutput(): Promise<void> {
    await Promise.all(
      [...this.received.values()].map(({ element }) =>
        "setSinkId" in element ? element.setSinkId("") : Promise.resolve(),
      ),
    );
    this.outputDeviceId = null;
  }

  /**
   * Plays each element and yields its consumer id, then waits for the caller to tell the
   * server before moving on.
   *
   * A generator rather than a returned list because the two halves must stay paired: play
   * them all first and report afterwards, and a single refused `play()` leaves the streams
   * that already started paused on the server while the browser is ready for them.
   */
  async *resume(): AsyncGenerator<string> {
    for (const received of this.received.values()) {
      await received.element.play();
      yield received.consumer.id;
    }
  }

  close(producerId: string): void {
    const received = this.received.get(producerId);
    if (!received) return;
    received.consumer.close();
    received.element.pause();
    received.element.srcObject = null;
    received.element.remove();
    this.received.delete(producerId);
  }

  closeAll(): void {
    for (const producerId of [...this.received.keys()]) this.close(producerId);
  }
}
