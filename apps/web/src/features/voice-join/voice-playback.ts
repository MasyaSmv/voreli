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
