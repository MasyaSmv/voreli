import type { ConversationChat, RealtimeConversationAdapter } from "./conversation-contract";
export type { ConversationChat } from "./conversation-contract";
import { useConversationTimeline } from "./useConversationTimeline";
import { useConversationSend } from "./useConversationSend";
import { useQueryClient } from "@tanstack/react-query";
import { TYPING_TTL_MS } from "@voreli/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { chatSocket } from "../../shared/api/socket";

export function useRealtimeConversation(
  adapter: RealtimeConversationAdapter | null,
): ConversationChat {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const timeline = useConversationTimeline(adapter);
  const { messages, cache } = timeline;
  const [typingUntil, setTypingUntil] = useState<
    ReadonlyMap<string, { name: string; until: string }>
  >(new Map());

  const [error, setError] = useState<string | null>(null);
  const [canSend, setCanSend] = useState(adapter !== null);
  const lastTypingSentAt = useRef(0);

  useEffect(() => {
    let cancelled = false;

    if (adapter === null) {
      queueMicrotask(() => {
        if (!cancelled) {
          cache.clear();
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
        setError(null);
        setCanSend(true);
      }
    });
    const subscribe = (): void => {
      void socket
        .timeout(10_000)
        .emitWithAck(adapter.events.subscribe, adapter.payload())
        .then(() => queryClient.invalidateQueries({ queryKey: cache.key }))
        .catch((error: unknown) => {
          console.error("Chat subscription failed", { error, conversation: cache.key });
          if (!cancelled) setError(adapter.historyError);
        });
    };
    subscribe();
    socket.on("connect", subscribe);

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
      if (!adapter.retainMessagesOnRevoke) cache.clear();
      setTypingUntil(new Map());
      setError(adapter.revokedError);
      setCanSend(false);
      for (const queryKey of adapter.invalidate()) {
        void queryClient.invalidateQueries({ queryKey });
      }
    };
    socket.on(adapter.events.typing, onTyping);
    socket.on(adapter.events.accessRevoked, onRevoked);

    return () => {
      cancelled = true;
      socket.off("connect", subscribe);
      socket.off(adapter.events.typing, onTyping);
      socket.off(adapter.events.accessRevoked, onRevoked);
      void socket.emitWithAck(adapter.events.unsubscribe, adapter.payload());
    };
  }, [adapter, cache, queryClient, t]);

  useEffect(() => {
    const latest = messages.findLast((message) => !message.id.startsWith("pending:"));
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

  const sender = useConversationSend(adapter, canSend, cache);
  const notifyTyping = useCallback((): void => {
    if (adapter === null || !canSend) return;
    const now = Date.now();
    if (now - lastTypingSentAt.current < TYPING_TTL_MS / 2) return;
    lastTypingSentAt.current = now;
    void chatSocket().emitWithAck(adapter.events.typingStart, adapter.payload());
  }, [adapter, canSend]);

  const typing = useMemo(() => [...typingUntil.values()].map((item) => item.name), [typingUntil]);
  return {
    messages,
    typing,
    loading: timeline.loading,
    error: error ?? sender.error ?? timeline.error,
    canSend,
    send: sender.send,
    notifyTyping,
    loadOlder: timeline.loadOlder,
    hasOlder: timeline.hasOlder,
    reveal: timeline.reveal,
  };
}

export function stringField(value: unknown, field: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === "string" ? candidate : null;
}
