import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import type { types } from "mediasoup";

import { RouterRegistryService } from "../../media/router-registry.service.js";
import { VoiceBroadcaster } from "./voice-broadcaster.js";

interface SpeakingRoom {
  readonly observer: types.AudioLevelObserver;
  readonly usersByProducer: Map<string, string>;
}

@Injectable()
export class SpeakingService implements OnModuleDestroy {
  private readonly logger = new Logger(SpeakingService.name);
  private readonly rooms = new Map<string, SpeakingRoom>();
  private readonly creations = new Map<string, Promise<SpeakingRoom>>();

  constructor(
    private readonly routers: RouterRegistryService,
    private readonly broadcaster: VoiceBroadcaster,
  ) {}

  async addProducer(channelId: string, userId: string, producer: types.Producer): Promise<void> {
    const room = await this.room(channelId);
    room.usersByProducer.set(producer.id, userId);
    try {
      await room.observer.addProducer({ producerId: producer.id });
    } catch (error: unknown) {
      room.usersByProducer.delete(producer.id);
      throw error;
    }
  }

  async removeProducer(channelId: string, producerId: string): Promise<void> {
    const room = this.rooms.get(channelId);
    if (!room || !room.usersByProducer.delete(producerId) || room.observer.closed) return;

    try {
      await room.observer.removeProducer({ producerId });
    } catch (error: unknown) {
      this.logger.error({
        message: "Failed to remove voice producer from audio observer",
        error,
        channelId,
        producerId,
        operation: "removeSpeakingProducer",
      });
    }
  }

  forgetProducer(channelId: string, producerId: string): void {
    this.rooms.get(channelId)?.usersByProducer.delete(producerId);
  }

  onModuleDestroy(): void {
    for (const room of this.rooms.values()) {
      if (!room.observer.closed) room.observer.close();
    }
    this.rooms.clear();
  }

  private async room(channelId: string): Promise<SpeakingRoom> {
    const current = this.rooms.get(channelId);
    if (current) return current;

    const pending = this.creations.get(channelId) ?? this.createRoom(channelId);
    this.creations.set(channelId, pending);
    try {
      return await pending;
    } finally {
      this.creations.delete(channelId);
    }
  }

  private async createRoom(channelId: string): Promise<SpeakingRoom> {
    const handle = this.routers.get(channelId);
    if (!handle) throw new Error(`Voice Router ${channelId} does not exist`);

    const observer = await handle.router.createAudioLevelObserver({
      interval: 400,
      threshold: -50,
      maxEntries: 4,
    });
    const created: SpeakingRoom = { observer, usersByProducer: new Map() };
    this.rooms.set(channelId, created);

    observer.on("volumes", (volumes) => {
      const speaking = volumes.flatMap(({ producer, volume }) => {
        const userId = created.usersByProducer.get(producer.id);
        return userId === undefined ? [] : [{ userId, level: volume }];
      });
      this.broadcaster.speaking(channelId, { speaking });
    });
    observer.on("silence", () => this.broadcaster.speaking(channelId, { speaking: [] }));
    observer.observer.once("close", () => {
      if (this.rooms.get(channelId) === created) this.rooms.delete(channelId);
    });

    return created;
  }
}
