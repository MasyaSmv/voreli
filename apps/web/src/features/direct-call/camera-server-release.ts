import { VoiceClientEvent } from "@voreli/shared";

import type { VoiceSignaling } from "../voice-join/voice-signaling";

interface PublishedCamera {
  readonly mediaRoomId: string;
  readonly producerId: string;
}

/**
 * Tells the server a camera publication is over, now or once the socket is back.
 *
 * Closing the producer locally is not enough: the server keeps forwarding the producer to
 * the peer until it hears CameraStop. A stop while disconnected is kept and replayed after
 * the reconnect, but only into the same media room — in any other room that producer id
 * means nothing.
 */
export class CameraServerRelease {
  private pending: PublishedCamera | null = null;

  constructor(
    private readonly signaling: VoiceSignaling,
    private readonly room: { readonly channelId: string | null },
  ) {}

  /** A deliberate stop: sent now if possible, otherwise replayed by `flush`. */
  async stop(mediaRoomId: string, producerId: string): Promise<void> {
    if (this.signaling.connected) {
      await this.request({ mediaRoomId, producerId });
    } else {
      this.pending = { mediaRoomId, producerId };
    }
  }

  /** A publication nobody needs any more; with no socket, the server drops it on its own. */
  async stopIfConnected(mediaRoomId: string | null, producerId: string): Promise<void> {
    if (mediaRoomId && this.signaling.connected) await this.request({ mediaRoomId, producerId });
  }

  async flush(): Promise<void> {
    const pending = this.pending;
    this.pending = null;
    if (pending && pending.mediaRoomId === this.room.channelId && this.signaling.connected) {
      await this.request(pending);
    }
  }

  /** The session is over; a stop owed to its room is owed to no one. */
  forget(): void {
    this.pending = null;
  }

  private async request(camera: PublishedCamera): Promise<void> {
    await this.signaling.request<null>(VoiceClientEvent.CameraStop, camera);
  }
}
