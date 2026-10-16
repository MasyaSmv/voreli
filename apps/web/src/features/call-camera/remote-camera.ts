import { type DirectCallView, VoiceClientEvent } from "@voreli/shared";

import type { OwnUserId } from "../../entities/session/session-identity";
import type { VoiceSignaling } from "../../entities/voice/voice-signaling";
import type { CameraConsumer, CameraMediaGraph, CameraView, CameraVoiceRoom } from "./camera-media";

/** What receiving the peer's camera needs to know about the call, and the one fact it sets. */
export interface RemoteCameraCallState {
  readonly call: DirectCallView | null;
  readonly mediaRoomId: string | null;
  remoteCamera(on: boolean): void;
}

/**
 * The peer's camera in a call: one consumer at a time, shown through one view.
 *
 * A producer can be announced twice — once by its ProducerNew event, once more by the
 * existing-producer sweep after a join or reconnect — so a producer already shown or being
 * set up is ignored. A newer producer replaces the older one, and `generation` lets the
 * older setup, still waiting for its consumer, notice it lost and close what it got.
 */
export class RemoteCameraReceiver {
  private consumer: CameraConsumer | null = null;
  private producerId: string | null = null;
  private pendingProducerId: string | null = null;
  private generation = 0;

  constructor(
    private readonly signaling: VoiceSignaling,
    private readonly room: Pick<CameraVoiceRoom, "channelId">,
    private readonly state: RemoteCameraCallState,
    private readonly media: Pick<CameraMediaGraph, "createCameraConsumer">,
    private readonly view: CameraView,
    private readonly self: OwnUserId,
  ) {}

  async consume(userId: string, producerId: string): Promise<void> {
    if (!this.isPeerInActiveCall(userId)) return;
    if (this.producerId === producerId || this.pendingProducerId === producerId) return;
    this.close();
    const generation = ++this.generation;
    this.pendingProducerId = producerId;
    let consumer: CameraConsumer;
    try {
      consumer = await this.media.createCameraConsumer(producerId);
    } catch (error: unknown) {
      if (generation === this.generation) this.pendingProducerId = null;
      throw error;
    }
    if (generation !== this.generation) {
      consumer.close();
      return;
    }
    this.pendingProducerId = null;
    this.consumer = consumer;
    this.producerId = producerId;
    this.view.show(consumer.track);
    this.state.remoteCamera(true);
    try {
      await this.signaling.request<null>(VoiceClientEvent.ResumeConsumer, {
        consumerId: consumer.id,
      });
    } catch (error: unknown) {
      if (generation === this.generation) this.close();
      throw error;
    }
  }

  closed(producerId: string): void {
    if (this.producerId === producerId) this.close();
  }

  close(): void {
    this.generation += 1;
    this.pendingProducerId = null;
    this.consumer?.close();
    this.consumer = null;
    this.producerId = null;
    this.view.show(null);
    this.state.remoteCamera(false);
  }

  private isPeerInActiveCall(userId: string): boolean {
    const call = this.state.call;
    return (
      call !== null &&
      call.status === "ACTIVE" &&
      this.state.mediaRoomId === this.room.channelId &&
      userId !== this.self() &&
      [call.caller.id, call.callee.id].includes(userId)
    );
  }
}
