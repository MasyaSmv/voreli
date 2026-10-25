import {
  IndexedDbOutboxStorage,
  type OutboxContainer,
  type OutboxStorage,
  type PendingTextMessage,
} from "./outbox-storage";

export class OutboxStateChangedError extends Error {
  constructor() {
    super("Outbox message state changed");
    this.name = "OutboxStateChangedError";
  }
}

export class MessageOutbox {
  private activeUserId: string | null = null;
  private items: readonly PendingTextMessage[] = [];
  private readonly listeners = new Set<() => void>();
  private writes: Promise<void> = Promise.resolve();
  private generation = 0;

  constructor(private readonly storage: OutboxStorage) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = (): readonly PendingTextMessage[] => this.items;

  activate(userId: string): Promise<void> {
    const generation = ++this.generation;
    return this.serial(async () => {
      if (generation !== this.generation) return;
      if (this.activeUserId === userId) return;
      this.activeUserId = userId;
      this.replace([]);
      try {
        const stored = await this.storage.list(userId);
        const restored = await Promise.all(
          stored.map(async (item) => {
            if (item.state !== "sending") return item;
            const reset: PendingTextMessage = { ...item, state: "queued", uncertain: true };
            await this.storage.put(reset);
            return reset;
          }),
        );
        if (generation === this.generation && this.activeUserId === userId) this.replace(restored);
      } catch (error: unknown) {
        if (generation === this.generation) {
          this.activeUserId = null;
          this.replace([]);
        }
        throw error;
      }
    });
  }

  deactivate(): void {
    this.generation += 1;
    this.activeUserId = null;
    this.replace([]);
  }

  enqueue(
    userId: string,
    container: OutboxContainer,
    text: string,
    replyToId: string | null,
  ): Promise<PendingTextMessage> {
    return this.serial(async () => {
      if (this.activeUserId !== userId) throw new Error("Outbox belongs to another user");
      const item: PendingTextMessage = {
        localId: crypto.randomUUID(),
        userId,
        clientNonce: crypto.randomUUID(),
        container,
        text,
        replyToId,
        createdAt: new Date().toISOString(),
        state: "queued",
        attempt: 0,
        retryAt: null,
        uncertain: false,
        errorCode: null,
      };
      await this.storage.put(item);
      this.replace([...this.items, item]);
      return item;
    });
  }

  update(
    userId: string,
    localId: string,
    change: (item: PendingTextMessage) => PendingTextMessage,
  ): Promise<PendingTextMessage | null> {
    return this.serial(async () => {
      if (this.activeUserId !== userId) return null;
      const current = this.items.find((item) => item.localId === localId);
      if (!current) return null;
      const updated = change(current);
      if (updated.userId !== userId || updated.localId !== localId)
        throw new Error("Outbox identity cannot change");
      await this.storage.put(updated);
      this.replace(this.items.map((item) => (item.localId === localId ? updated : item)));
      return updated;
    });
  }

  remove(userId: string, localId: string): Promise<void> {
    return this.serial(async () => {
      if (this.activeUserId !== userId) return;
      await this.storage.remove(userId, localId);
      this.replace(this.items.filter((item) => item.localId !== localId));
    });
  }

  discard(userId: string, localId: string): Promise<void> {
    return this.serial(async () => {
      if (this.activeUserId !== userId) return;
      const current = this.items.find((item) => item.localId === localId);
      if (!current) return;
      if (current.state === "sending") throw new OutboxStateChangedError();
      await this.storage.remove(userId, localId);
      this.replace(this.items.filter((item) => item.localId !== localId));
    });
  }

  clearForLogout(userId: string): Promise<void> {
    return this.serial(async () => {
      await this.storage.clear(userId);
      if (this.activeUserId === userId) {
        this.activeUserId = null;
        this.replace([]);
      }
    });
  }

  private replace(items: readonly PendingTextMessage[]): void {
    this.items = items;
    for (const listener of this.listeners) listener();
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.writes.then(work, work);
    this.writes = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export const messageOutbox = new MessageOutbox(new IndexedDbOutboxStorage());
