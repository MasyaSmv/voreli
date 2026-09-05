import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { createWorker, type types } from "mediasoup";

import { MediaConfig } from "./media.config.js";

/** How long a shutdown waits for one worker subprocess before giving up on it. */
const SUBPROCESS_EXIT_TIMEOUT_MS = 5_000;

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
      await Promise.all(slots.map((slot) => this.closeWorker(slot.worker)));

      throw error;
    }

    this.slots = slots;
    this.logger.log(`Started ${String(slots.length)} mediasoup worker(s)`);
  }

  async onModuleDestroy(): Promise<void> {
    const closing = this.slots.map((slot) => this.closeWorker(slot.worker));
    this.slots = [];

    await Promise.all(closing);
  }

  all(): readonly MediaWorkerSlot[] {
    if (this.slots.length === 0) {
      throw new Error("Mediasoup worker pool is not initialized");
    }

    return this.slots;
  }

  /**
   * Waits for the worker's subprocess to actually exit, not merely for `close()` to be
   * called on it.
   *
   * The RTC ports belong to that subprocess, and the kernel frees them only once it is
   * gone. Returning earlier means the next boot binds the same port and dies with
   * EADDRINUSE — which is exactly what the test suite does, one application per file.
   */
  private closeWorker(worker: types.Worker): Promise<void> {
    if (worker.closed) return Promise.resolve();

    const exited = new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        resolve();
      };
      // Bounded, because a shutdown that never finishes is worse than a port held a moment
      // too long: it would hang the process instead of failing it.
      const timer = setTimeout(() => {
        this.logger.warn({
          message: "Mediasoup worker did not report its subprocess exit in time",
          errorCode: "MEDIASOUP_WORKER_CLOSE_TIMEOUT",
          workerPid: worker.pid,
        });
        resolve();
      }, SUBPROCESS_EXIT_TIMEOUT_MS);
      worker.once("subprocessclose", done);
    });

    worker.close();

    return exited;
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
