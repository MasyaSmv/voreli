import {
  type ChannelAccessRevokedEvent,
  ClientEvent,
  type MessageDeletedEvent,
  type MessageView,
  ServerEvent,
  type TypingEvent,
  TYPING_TTL_MS,
} from "@voreli/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchHistory } from "../../entities/message/message.api";
import { chatSocket } from "../../shared/api/socket";

interface ChannelChat {
  readonly messages: readonly MessageView[];
  readonly typing: readonly string[];
  readonly loading: boolean;
  readonly error: string | null;
  send: (text: string) => Promise<void>;
  notifyTyping: () => void;
}

interface Ack {
  readonly ok: boolean;
  readonly errorCode?: string;
  readonly message?: string;
}

/** Socket.IO acknowledgements arrive untyped; narrow them at the boundary, once. */
function toAck(value: unknown): Ack {
  if (typeof value !== "object" || value === null) {
    return { ok: false };
  }

  const record = value as Record<string, unknown>;

  return {
    ok: record["ok"] === true,
    ...(typeof record["errorCode"] === "string" ? { errorCode: record["errorCode"] } : {}),
    ...(typeof record["message"] === "string" ? { message: record["message"] } : {}),
  };
}

/**
 * Everything one channel needs: history on open, live messages while open, and typing.
 *
 * Subscription is explicit and scoped to the channel currently on screen — the server only
 * sends events for rooms a socket has joined, so switching channels leaves the old room.
 */
export function useChannelChat(channelId: string | null): ChannelChat {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<readonly MessageView[]>([]);
  const [typingUntil, setTypingUntil] = useState<ReadonlyMap<string, TypingEvent>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastTypingSentAt = useRef(0);

  useEffect(() => {
    if (channelId === null) {
      setMessages([]);

      return;
    }

    const socket = chatSocket();
    let cancelled = false;

    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const page = await fetchHistory(channelId);

        if (!cancelled) {
          // The API returns newest first; the view reads oldest at the top.
          setMessages([...page.messages].reverse());
        }
      } catch {
        if (!cancelled) {
          setError("Не удалось загрузить историю канала");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    void socket.emitWithAck(ClientEvent.Subscribe, { channelId });

    const onMessage = (message: MessageView): void => {
      if (message.channelId !== channelId) {
        return;
      }

      setMessages((current) =>
        current.some((existing) => existing.id === message.id)
          ? current
          : [...current.filter((existing) => existing.id !== message.clientNonce), message],
      );
    };

    // Edits and deletions also arrive when someone changes a message over HTTP, so the
    // view stays current without reloading history.
    const onMessageUpdated = (message: MessageView): void => {
      if (message.channelId !== channelId) {
        return;
      }

      setMessages((current) =>
        current.map((existing) => (existing.id === message.id ? message : existing)),
      );
    };

    const onMessageDeleted = (event: MessageDeletedEvent): void => {
      if (event.channelId !== channelId) {
        return;
      }

      setMessages((current) => current.filter((existing) => existing.id !== event.messageId));
    };

    const onTyping = (event: TypingEvent): void => {
      if (event.channelId !== channelId) {
        return;
      }

      setTypingUntil((current) => new Map(current).set(event.userId, event));
    };

    const onAccessRevoked = (event: ChannelAccessRevokedEvent): void => {
      if (event.channelId !== channelId) {
        return;
      }

      setMessages([]);
      setTypingUntil(new Map());
      setError("Доступ к каналу отозван");
      void queryClient.invalidateQueries({ queryKey: ["server"] });
      void queryClient.invalidateQueries({ queryKey: ["unread"] });
    };

    socket.on(ServerEvent.MessageNew, onMessage);
    socket.on(ServerEvent.MessageUpdated, onMessageUpdated);
    socket.on(ServerEvent.MessageDeleted, onMessageDeleted);
    socket.on(ServerEvent.Typing, onTyping);
    socket.on(ServerEvent.ChannelAccessRevoked, onAccessRevoked);

    return () => {
      cancelled = true;
      socket.off(ServerEvent.MessageNew, onMessage);
      socket.off(ServerEvent.MessageUpdated, onMessageUpdated);
      socket.off(ServerEvent.MessageDeleted, onMessageDeleted);
      socket.off(ServerEvent.Typing, onTyping);
      socket.off(ServerEvent.ChannelAccessRevoked, onAccessRevoked);
      void socket.emitWithAck(ClientEvent.Unsubscribe, { channelId });
    };
  }, [channelId, queryClient]);

  // The indicator has to go out on its own: the server sends "started", never "stopped".
  useEffect(() => {
    if (typingUntil.size === 0) {
      return;
    }

    const timer = setInterval(() => {
      const now = Date.now();

      setTypingUntil((current) => {
        const kept = new Map(
          [...current].filter(([, event]) => new Date(event.until).getTime() > now),
        );

        return kept.size === current.size ? current : kept;
      });
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [typingUntil.size]);

  const send = useCallback(
    async (text: string): Promise<void> => {
      if (channelId === null) {
        return;
      }

      const ack = toAck(
        await chatSocket().emitWithAck(ClientEvent.SendMessage, { channelId, text }),
      );

      if (!ack.ok) {
        setError(
          ack.errorCode === "MISSING_PERMISSION"
            ? "В этом канале вам нельзя писать"
            : (ack.message ?? "Сообщение не отправлено"),
        );
      }
    },
    [channelId],
  );

  const notifyTyping = useCallback((): void => {
    if (channelId === null) {
      return;
    }

    // Throttled to one event per TTL: every keystroke would be a flood of identical events.
    const now = Date.now();

    if (now - lastTypingSentAt.current < TYPING_TTL_MS / 2) {
      return;
    }

    lastTypingSentAt.current = now;
    void chatSocket().emitWithAck(ClientEvent.TypingStart, { channelId });
  }, [channelId]);

  const typing = useMemo(
    () => [...typingUntil.values()].map((event) => event.displayName),
    [typingUntil],
  );

  return { messages, typing, loading, error, send, notifyTyping };
}
