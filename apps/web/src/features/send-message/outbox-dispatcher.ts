import { ClientEvent, type Ack, type MessageView } from "@voreli/shared";
import type { QueryClient } from "@tanstack/react-query";
import type { Socket } from "socket.io-client";

import { ConversationCache } from "../../entities/message/conversation-cache";
import type { MessageOutbox } from "../../entities/message/message-outbox";
import type { PendingTextMessage } from "../../entities/message/outbox-storage";
import { refreshAccessToken } from "../../shared/api/http";

export interface OutboxTransport {
  readonly connected: boolean;
  send(item: PendingTextMessage): Promise<Ack<{ message: MessageView }>>;
  onConnect(listener: () => void): () => void;
}

export class SocketOutboxTransport implements OutboxTransport {
  constructor(private readonly socket: Socket) {}

  get connected(): boolean {
    return this.socket.connected;
  }

  send(item: PendingTextMessage): Promise<Ack<{ message: MessageView }>> {
    const event =
      item.container.kind === "channel" ? ClientEvent.SendMessage : ClientEvent.DirectSendMessage;
    const identity =
      item.container.kind === "channel"
        ? { channelId: item.container.id }
        : { conversationId: item.container.id };
    return this.socket.timeout(10_000).emitWithAck(event, {
      ...identity,
      text: item.text,
      ...(item.replyToId ? { replyToId: item.replyToId } : {}),
      clientNonce: item.clientNonce,
    }) as Promise<Ack<{ message: MessageView }>>;
  }

  onConnect(listener: () => void): () => void {
    let active = true;
    this.socket.on("connect", listener);
    const onConnectError = (error: Error): void => {
      if (error.message !== "UNAUTHENTICATED") return;
      void refreshAccessToken()
        .then((refreshed) => {
          if (active && refreshed) this.socket.connect();
        })
        .catch((cause: unknown) => {
          console.error("Outbox socket authentication refresh failed", { cause });
        });
    };
    this.socket.on("connect_error", onConnectError);
    return () => {
      active = false;
      this.socket.off("connect", listener);
      this.socket.off("connect_error", onConnectError);
    };
  }
}

export class OutboxDispatcher {
  private running = false;
  private pendingWake = false;
  private stopped = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeOutbox: (() => void) | undefined;
  private unsubscribeConnect: (() => void) | undefined;

  constructor(
    private readonly outbox: MessageOutbox,
    private readonly transport: OutboxTransport,
    private readonly queryClient: QueryClient,
    private readonly userId: string,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.unsubscribeOutbox = this.outbox.subscribe(this.wake);
    this.unsubscribeConnect = this.transport.onConnect(this.onConnect);
    this.onConnect();
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribeOutbox?.();
    this.unsubscribeConnect?.();
    this.unsubscribeOutbox = undefined;
    this.unsubscribeConnect = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private readonly onConnect = (): void => {
    if (this.stopped || !this.transport.connected) return;
    void this.resumeAuthRequired().catch((error: unknown) => {
      console.error("Outbox auth resume failed", { error, userId: this.userId });
    });
    this.wake();
  };

  private async resumeAuthRequired(): Promise<void> {
    for (const item of this.outbox.snapshot()) {
      if (item.userId !== this.userId || item.state !== "auth-required") continue;
      await this.outbox.update(this.userId, item.localId, (current) => ({
        ...current,
        state: "queued",
        retryAt: null,
      }));
    }
  }

  private readonly wake = (): void => {
    if (this.stopped || !this.transport.connected) return;
    if (this.running) {
      this.pendingWake = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.drain().catch((error: unknown) => {
      console.error("Outbox flush failed", { error, userId: this.userId });
    });
  };

  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (!this.stopped && this.transport.connected) {
        const now = Date.now();
        const pending = this.outbox
          .snapshot()
          .filter((item) => item.userId === this.userId && item.state === "queued")
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
        const firstPerContainer = new Map<string, PendingTextMessage>();
        for (const item of pending) {
          const key = `${item.container.kind}:${item.container.id}`;
          if (!firstPerContainer.has(key)) firstPerContainer.set(key, item);
        }
        const eligible = [...firstPerContainer.values()];
        const ready = eligible.find((item) => item.retryAt === null || item.retryAt <= now);
        if (!ready) {
          const nextRetry = Math.min(...eligible.map((item) => item.retryAt ?? Infinity));
          if (Number.isFinite(nextRetry))
            this.timer = setTimeout(this.wake, Math.max(0, nextRetry - now));
          return;
        }
        await this.deliver(ready);
      }
    } finally {
      this.running = false;
      if (this.pendingWake) {
        this.pendingWake = false;
        queueMicrotask(this.wake);
      }
    }
  }

  private async deliver(item: PendingTextMessage): Promise<void> {
    const sending = await this.outbox.update(this.userId, item.localId, (current) => ({
      ...current,
      state: "sending",
      attempt: current.attempt + 1,
      retryAt: null,
    }));
    if (!sending) return;
    if (this.stopped || !this.transport.connected) {
      await this.outbox.update(this.userId, sending.localId, (current) => ({
        ...current,
        state: "queued",
        retryAt: null,
      }));
      return;
    }
    try {
      const ack = await this.transport.send(sending);
      if (this.stopped) return;
      if (ack.ok) {
        this.insertDelivered(ack.data.message, sending);
        await this.outbox.remove(this.userId, sending.localId);
      } else if (ack.errorCode === "UNAUTHENTICATED") {
        await this.outbox.update(this.userId, sending.localId, (current) => ({
          ...current,
          state: "auth-required",
          errorCode: ack.errorCode,
        }));
      } else if (ack.errorCode === "INTERNAL_ERROR" || ack.errorCode === "RATE_LIMITED") {
        await this.retryLater(sending, ack.errorCode);
      } else {
        await this.outbox.update(this.userId, sending.localId, (current) => ({
          ...current,
          state: current.uncertain ? "unknown" : "failed",
          errorCode: ack.errorCode,
        }));
      }
    } catch (error: unknown) {
      console.error("Outbox send failed", { error, localId: sending.localId });
      if (!this.stopped) await this.retryLater(sending, "TRANSPORT_ERROR");
    }
  }

  private retryLater(
    item: PendingTextMessage,
    errorCode: string,
  ): Promise<PendingTextMessage | null> {
    const delay = Math.min(60_000, 1000 * 2 ** Math.min(item.attempt, 6));
    return this.outbox.update(this.userId, item.localId, (current) => ({
      ...current,
      state: "queued",
      uncertain: true,
      retryAt: Date.now() + delay / 2 + (Math.random() * delay) / 2,
      errorCode,
    }));
  }

  private insertDelivered(message: MessageView, item: PendingTextMessage): void {
    const container =
      item.container.kind === "channel"
        ? { channelId: item.container.id }
        : { conversationId: item.container.id };
    const key = ["conversation-messages", this.userId, JSON.stringify(container)];
    new ConversationCache(this.queryClient, key).insert(message);
  }
}
