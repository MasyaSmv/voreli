import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { types } from "mediasoup";

import { MediaConfig, VOICE_MEDIA_CODECS } from "./media.config.js";
import { type MediaWorkerSlot, WorkerPoolService } from "./worker-pool.service.js";

export interface VoiceRouterHandle {
  readonly router: types.Router;
  readonly webRtcServer: types.WebRtcServer;
}

interface RouterEntry extends VoiceRouterHandle {
  readonly workerIndex: number;
  participants: number;
  idleTimer?: NodeJS.Timeout;
}

@Injectable()
export class RouterRegistryService implements OnModuleDestroy {
  private readonly entries = new Map<string, RouterEntry>();
  private readonly creations = new Map<string, Promise<RouterEntry>>();

  constructor(
    private readonly workers: WorkerPoolService,
    private readonly config: MediaConfig,
  ) {}

  async acquire(channelId: string): Promise<VoiceRouterHandle> {
    let entry = this.entries.get(channelId);

    if (!entry) {
      const creation = this.creations.get(channelId) ?? this.create(channelId);
      this.creations.set(channelId, creation);

      try {
        entry = await creation;
      } finally {
        this.creations.delete(channelId);
      }
    }

    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      delete entry.idleTimer;
    }

    entry.participants += 1;
    return { router: entry.router, webRtcServer: entry.webRtcServer };
  }

  release(channelId: string): void {
    const entry = this.entries.get(channelId);

    if (!entry || entry.participants === 0) {
      return;
    }

    entry.participants -= 1;

    if (entry.participants === 0) {
      entry.idleTimer = setTimeout(() => this.close(channelId, entry), this.config.routerIdleTtlMs);
      entry.idleTimer.unref();
    }
  }

  get(channelId: string): VoiceRouterHandle | undefined {
    const entry = this.entries.get(channelId);
    return entry ? { router: entry.router, webRtcServer: entry.webRtcServer } : undefined;
  }

  onModuleDestroy(): void {
    for (const [channelId, entry] of this.entries) {
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
      }

      this.entries.delete(channelId);
      entry.router.close();
    }
  }

  private async create(channelId: string): Promise<RouterEntry> {
    const slot = this.leastLoadedWorker();
    const router = await slot.worker.createRouter({ mediaCodecs: [...VOICE_MEDIA_CODECS] });
    const entry: RouterEntry = {
      router,
      webRtcServer: slot.webRtcServer,
      workerIndex: slot.index,
      participants: 0,
    };
    this.entries.set(channelId, entry);
    router.observer.once("close", () => this.entries.delete(channelId));
    return entry;
  }

  private leastLoadedWorker(): MediaWorkerSlot {
    const counts = new Map<number, number>();

    for (const entry of this.entries.values()) {
      counts.set(entry.workerIndex, (counts.get(entry.workerIndex) ?? 0) + 1);
    }

    return this.workers
      .all()
      .reduce((best, slot) =>
        (counts.get(slot.index) ?? 0) < (counts.get(best.index) ?? 0) ? slot : best,
      );
  }

  private close(channelId: string, expected: RouterEntry): void {
    if (this.entries.get(channelId) !== expected || expected.participants > 0) {
      return;
    }

    if (expected.idleTimer) {
      clearTimeout(expected.idleTimer);
    }

    this.entries.delete(channelId);
    expected.router.close();
  }
}
