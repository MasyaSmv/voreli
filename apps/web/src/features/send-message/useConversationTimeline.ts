import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MessageView } from "@voreli/shared";
import { useEffect, useMemo, useRef } from "react";
import { ConversationCache } from "../../entities/message/conversation-cache";
import { useSession } from "../../entities/session/session.store";
import { chatSocket } from "../../shared/api/socket";
import type { RealtimeConversationAdapter } from "./conversation-contract";

export function useConversationTimeline(adapter: RealtimeConversationAdapter | null) {
  const client = useQueryClient();
  const userId = useSession((state) => state.user?.id);
  const container = JSON.stringify(adapter?.payload() ?? null);
  const cache = useMemo(
    () => new ConversationCache(client, ["conversation-messages", userId, container]),
    [client, userId, container],
  );
  const revealTarget = useRef<string | null>(null);
  const history = useQuery({
    queryKey: cache.key,
    enabled: adapter !== null,
    queryFn: async () => {
      if (!adapter) throw new Error("Missing conversation");
      const page = await adapter.fetchHistory();
      return { ...page, messages: [...page.messages].reverse() };
    },
  });
  useEffect(() => {
    if (!adapter) return;
    const socket = chatSocket();
    const inserted = (message: MessageView) => {
      if (adapter.messageBelongs(message)) cache.insert(message);
    };
    const updated = (message: MessageView) => {
      if (adapter.messageBelongs(message)) cache.update(message);
    };
    const removed = (event: unknown) => {
      const id = adapter.deletedMessageId(event);
      if (id) cache.remove(id);
    };
    socket.on(adapter.events.messageNew, inserted);
    socket.on(adapter.events.messageUpdated, updated);
    socket.on(adapter.events.messageDeleted, removed);
    return () => {
      socket.off(adapter.events.messageNew, inserted);
      socket.off(adapter.events.messageUpdated, updated);
      socket.off(adapter.events.messageDeleted, removed);
    };
  }, [adapter, cache]);
  useEffect(() => {
    const target = revealTarget.current;
    if (!target || !history.data?.messages.some((message) => message.id === target)) return;
    document.getElementById(`message-${target}`)?.scrollIntoView({ block: "center" });
    revealTarget.current = null;
  }, [history.data?.messages]);
  async function loadOlder(): Promise<void> {
    const cursor = cache.page()?.nextCursor;
    if (!adapter || !cursor) return;
    try {
      cache.prepend(await adapter.fetchHistory(cursor));
    } catch (error: unknown) {
      console.error("Older message history failed", { error, container });
      throw error;
    }
  }
  async function reveal(messageId: string): Promise<void> {
    try {
      if (cache.page()?.messages.some((message) => message.id === messageId)) {
        document.getElementById(`message-${messageId}`)?.scrollIntoView({ block: "center" });
        return;
      }
      revealTarget.current = messageId;
      while (!cache.page()?.messages.some((message) => message.id === messageId)) {
        if (!cache.page()?.nextCursor) {
          revealTarget.current = null;
          return;
        }
        await loadOlder();
      }
    } catch (error: unknown) {
      console.error("Reply target could not be revealed", { error, messageId });
      revealTarget.current = null;
    }
  }
  return {
    cache,
    messages: history.data?.messages ?? [],
    loading: history.isLoading,
    error: history.error ? (adapter?.historyError ?? null) : null,
    loadOlder,
    reveal,
    hasOlder: Boolean(history.data?.nextCursor),
  };
}
