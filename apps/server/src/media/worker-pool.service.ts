import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { createWorker, type types } from "mediasoup";

import { MediaConfig } from "./media.config.js";

export interface MediaWorkerSlot {
  readonly index: number;
  readonly worker: types.Worker;
  readonly webRtcServer: types.WebRtcServer;
}

@Injectable()
export class WorkerPoolService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerPoolService.name);
  private slots: readonly MediaWorkerSlot[] = [];

  constructor(private readonly config: MediaConfig) {}

  async onModuleInit(): Promise<void> {
    this.config.assertWorkerPortsFit();

    const slots: MediaWorkerSlot[] = [];

    try {
      for (let index = 0; index < this.config.workerCount; index += 1) {
        slots.push(await this.createSlot(index));
      }
    } catch (error: unknown) {
      for (const slot of slots) {
        slot.worker.close();
      }

      throw error;
    }

    this.slots = slots;
    this.logger.log(`Started ${String(slots.length)} mediasoup worker(s)`);
  }

  onModuleDestroy(): void {
    for (const slot of this.slots) {
      slot.worker.close();
    }

    this.slots = [];
  }

  all(): readonly MediaWorkerSlot[] {
    if (this.slots.length === 0) {
      throw new Error("Mediasoup worker pool is not initialized");
    }

    return this.slots;
  }

  private async createSlot(index: number): Promise<MediaWorkerSlot> {
    const worker = await createWorker({ logLevel: this.config.logLevel });

    worker.on("died", (error) => {
      this.logger.error({
        message: "Mediasoup worker died; terminating the process because its routers are lost",
        error,
        errorCode: "MEDIASOUP_WORKER_DIED",
        workerPid: worker.pid,
        workerIndex: index,
      });
      process.exit(1);
    });

    try {
      const port = this.config.minimumPort + index;
      const webRtcServer = await worker.createWebRtcServer({
        listenInfos: [
          {
            protocol: "udp",
            ip: this.config.listenIp,
            announcedAddress: this.config.announcedIp,
            port,
          },
          {
            protocol: "tcp",
            ip: this.config.listenIp,
            announcedAddress: this.config.announcedIp,
            port,
          },
        ],
      });

      return { index, worker, webRtcServer };
    } catch (error: unknown) {
      worker.close();
      throw error;
    }
  }
}
