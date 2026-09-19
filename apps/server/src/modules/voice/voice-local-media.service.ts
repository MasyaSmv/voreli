import { Injectable } from "@nestjs/common";
import type { ScreenShareView } from "@voreli/shared";

import {
  RouterRegistryService,
  type VoiceRouterHandle,
} from "../../media/router-registry.service.js";
import { MediaSessionRegistry, type SessionProducerView } from "./media-session.registry.js";
import { ScreenShareLifecycleService } from "./screen-share-lifecycle.service.js";
import { SpeakingService } from "./speaking.service.js";

/** Coordinates the local mediasoup resources that back one distributed voice session. */
@Injectable()
export class VoiceLocalMediaService {
  constructor(
    private readonly routers: RouterRegistryService,
    private readonly media: MediaSessionRegistry,
    private readonly speaking: SpeakingService,
    private readonly screenShares: ScreenShareLifecycleService,
  ) {}

  onTransportFailure(handler: (sessionId: string) => Promise<void> | void): () => void {
    return this.media.onTransportFailure(handler);
  }

  onTransportReconnect(
    handler: (sessionId: string, reconnecting: boolean) => Promise<void> | void,
  ): () => void {
    return this.media.onTransportReconnect(handler);
  }

  acquire(mediaRoomId: string): Promise<VoiceRouterHandle> {
    return this.routers.acquire(mediaRoomId);
  }

  release(mediaRoomId: string): void {
    this.routers.release(mediaRoomId);
  }

  register(sessionId: string, mediaRoomId: string, handle: VoiceRouterHandle): void {
    this.media.register(sessionId, mediaRoomId, handle);
  }

  has(sessionId: string): boolean {
    return this.media.has(sessionId);
  }

  producers(sessionId: string): readonly SessionProducerView[] {
    return this.media.producersOfSession(sessionId);
  }

  activeScreenShares(mediaRoomId: string): Promise<readonly ScreenShareView[]> {
    return this.screenShares.activeIn(mediaRoomId);
  }

  async close(mediaRoomId: string, sessionId: string): Promise<boolean> {
    await this.screenShares.stopForSession(sessionId, "left");
    const producers = this.media.closeSession(sessionId);
    if (producers === null) return false;
    await Promise.all(
      producers
        .filter((producer) => producer.source === "microphone")
        .map((producer) => this.speaking.removeProducer(mediaRoomId, producer.producerId)),
    );
    this.routers.release(mediaRoomId);
    return true;
  }
}
