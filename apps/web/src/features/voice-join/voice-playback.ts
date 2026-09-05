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

    if (!deafened) await element.play();
  }

  async setDeafened(deafened: boolean): Promise<void> {
    for (const received of this.received.values()) {
      if (deafened) received.element.pause();
      else await received.element.play();
    }
  }

  /**
   * Listed rather than resumed in bulk: the caller has to tell the server about each
   * consumer right after that consumer's element starts playing. Resuming them all first
   * and reporting afterwards loses the ones already playing when a later `play()` is
   * refused — they stay paused on the server while the browser is ready for them.
   */
  entries(): readonly { readonly producerId: string; readonly consumerId: string }[] {
    return [...this.received].map(([producerId, received]) => ({
      producerId,
      consumerId: received.consumer.id,
    }));
  }

  async play(producerId: string): Promise<void> {
    await this.received.get(producerId)?.element.play();
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
