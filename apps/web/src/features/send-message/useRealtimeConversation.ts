import { useQueryClient } from "@tanstack/react-query";
import { type MessagePage, type MessageView, TYPING_TTL_MS } from "@voreli/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { chatSocket } from "../../shared/api/socket";

export interface RealtimeConversationAdapter {
  readonly events: {
    readonly subscribe: string;
    readonly unsubscribe: string;
    readonly send: string;
    readonly typingStart: string;
    readonly messageNew: string;
    readonly messageUpdated: string;
    readonly messageDeleted: string;
    readonly typing: string;
    readonly accessRevoked: string;
    readonly markRead?: string;
  };
  fetchHistory(): Promise<MessagePage>;
  payload(extra?: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;
  messageBelongs(message: MessageView): boolean;
  deletedMessageId(event: unknown): string | null;
  typingDescriptor(event: unknown): {
    readonly key: string;
    readonly name: string;
    readonly until: string;
  } | null;
  accessWasRevoked(event: unknown): boolean;
  invalidate(): readonly ReadonlyArray<unknown>[];
  readonly retainMessagesOnRevoke: boolean;
  readonly historyError: string;
  readonly revokedError: string;
}

export interface ConversationChat {
  readonly messages: readonly MessageView[];
  readonly typing: readonly string[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly canSend: boolean;
  readonly send: (text: string) => Promise<void>;
  readonly notifyTyping: () => void;
}

interface Ack {
  readonly ok: boolean;
  readonly message?: string;
}

function toAck(value: unknown): Ack {
  if (typeof value !== "object" || value === null) return { ok: false };
  const record = value as Record<string, unknown>;
  return {
    ok: record["ok"] === true,
    ...(typeof record["message"] === "string" ? { message: record["message"] } : {}),
  };
}

export function useRealtimeConversation(
  adapter: RealtimeConversationAdapter | null,
): ConversationChat {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<readonly MessageView[]>([]);
  const [typingUntil, setTypingUntil] = useState<
    ReadonlyMap<string, { name: string; until: string }>
  >(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canSend, setCanSend] = useState(adapter !== null);
  const lastTypingSentAt = useRef(0);

  useEffect(() => {
    let cancelled = false;

    if (adapter === null) {
      queueMicrotask(() => {
        if (!cancelled) {
          setMessages([]);
          setCanSend(false);
        }
      });
      return () => {
        cancelled = true;
      };
    }
    const socket = chatSocket();
    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setError(null);
        setCanSend(true);
      }
    });
    void adapter
      .fetchHistory()
      .then(
        (page) => {
          if (!cancelled) setMessages([...page.messages].reverse());
        },
        () => {
          if (!cancelled) setError(adapter.historyError);
        },
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    void socket.emitWithAck(adapter.events.subscribe, adapter.payload());

    const onMessage = (message: MessageView): void => {
      if (!adapter.messageBelongs(message)) return;
      setMessages((current) =>
        current.some((item) => item.id === message.id) ? current : [...current, message],
      );
    };
    const onUpdated = (message: MessageView): void => {
      if (!adapter.messageBelongs(message)) return;
      setMessages((current) => current.map((item) => (item.id === message.id ? message : item)));
    };
    const onDeleted = (event: unknown): void => {
      const messageId = adapter.deletedMessageId(event);
      if (messageId !== null) {
        setMessages((current) => current.filter((item) => item.id !== messageId));
      }
    };
    const onTyping = (event: unknown): void => {
      const descriptor = adapter.typingDescriptor(event);
      if (descriptor !== null) {
        setTypingUntil((current) =>
          new Map(current).set(descriptor.key, {
            name: descriptor.name,
            until: descriptor.until,
          }),
        );
      }
    };
    const onRevoked = (event: unknown): void => {
      if (!adapter.accessWasRevoked(event)) return;
      if (!adapter.retainMessagesOnRevoke) setMessages([]);
      setTypingUntil(new Map());
      setError(adapter.revokedError);
      setCanSend(false);
      for (const queryKey of adapter.invalidate()) {
        void queryClient.invalidateQueries({ queryKey });
      }
    };
    socket.on(adapter.events.messageNew, onMessage);
    socket.on(adapter.events.messageUpdated, onUpdated);
    socket.on(adapter.events.messageDeleted, onDeleted);
    socket.on(adapter.events.typing, onTyping);
    socket.on(adapter.events.accessRevoked, onRevoked);

    return () => {
      cancelled = true;
      socket.off(adapter.events.messageNew, onMessage);
      socket.off(adapter.events.messageUpdated, onUpdated);
      socket.off(adapter.events.messageDeleted, onDeleted);
      socket.off(adapter.events.typing, onTyping);
      socket.off(adapter.events.accessRevoked, onRevoked);
      void socket.emitWithAck(adapter.events.unsubscribe, adapter.payload());
    };
  }, [adapter, queryClient, t]);

  useEffect(() => {
    const latest = messages.at(-1);
    if (adapter?.events.markRead === undefined || latest === undefined) return;
    void chatSocket().emitWithAck(
      adapter.events.markRead,
      adapter.payload({ messageId: latest.id }),
    );
  }, [adapter, messages]);

  useEffect(() => {
    if (typingUntil.size === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setTypingUntil((current) => {
        const kept = new Map(
          [...current].filter(([, item]) => new Date(item.until).getTime() > now),
        );
        return kept.size === current.size ? current : kept;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [typingUntil.size]);

  const send = useCallback(
    async (text: string): Promise<void> => {
      if (adapter === null || !canSend) return;
      const ack = toAck(
        await chatSocket().emitWithAck(
          adapter.events.send,
          adapter.payload({ text, clientNonce: crypto.randomUUID() }),
        ),
      );
      if (!ack.ok) setError(ack.message ?? t("chat.errors.notSent"));
    },
    [adapter, canSend, t],
  );

  const notifyTyping = useCallback((): void => {
    if (adapter === null || !canSend) return;
    const now = Date.now();
    if (now - lastTypingSentAt.current < TYPING_TTL_MS / 2) return;
    lastTypingSentAt.current = now;
    void chatSocket().emitWithAck(adapter.events.typingStart, adapter.payload());
  }, [adapter, canSend]);

  const typing = useMemo(() => [...typingUntil.values()].map((item) => item.name), [typingUntil]);
  return { messages, typing, loading, error, canSend, send, notifyTyping };
}

export function stringField(value: unknown, field: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === "string" ? candidate : null;
}
