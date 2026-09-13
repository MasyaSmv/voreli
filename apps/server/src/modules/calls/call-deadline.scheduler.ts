import { Injectable, type OnModuleDestroy } from "@nestjs/common";

export const CALL_DEADLINE_SCHEDULER = Symbol("CALL_DEADLINE_SCHEDULER");

export interface CallDeadlineScheduler {
  schedule(callId: string, delayMs: number): void;
  cancel(callId: string): void;
  has(callId: string): boolean;
  onExpired(handler: (callId: string) => Promise<void>): () => void;
}

@Injectable()
export class LocalCallDeadlineScheduler implements CallDeadlineScheduler, OnModuleDestroy {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly handlers = new Set<(callId: string) => Promise<void>>();

  schedule(callId: string, delayMs: number): void {
    this.cancel(callId);
    const timer = setTimeout(() => {
      this.timers.delete(callId);
      for (const handler of this.handlers) void handler(callId);
    }, delayMs);
    timer.unref();
    this.timers.set(callId, timer);
  }

  cancel(callId: string): void {
    const timer = this.timers.get(callId);
    if (timer) clearTimeout(timer);
    this.timers.delete(callId);
  }

  has(callId: string): boolean {
    return this.timers.has(callId);
  }

  onExpired(handler: (callId: string) => Promise<void>): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.handlers.clear();
  }
}
