import { useSession } from "../../entities/session/session.store";
import type { Ack, MessageView } from "@voreli/shared";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConversationCache } from "../../entities/message/conversation-cache";
import { messageOutbox } from "../../entities/message/message-outbox";
import type { OutboxContainer } from "../../entities/message/outbox-storage";
import { chatSocket } from "../../shared/api/socket";
import type { RealtimeConversationAdapter } from "./conversation-contract";

export function useConversationSend(
  adapter: RealtimeConversationAdapter | null,
  canSend: boolean,
  cache: ConversationCache,
) {
  const { t } = useTranslation();
  const user = useSession((state) => state.user);
  const retry = useRef<{ signature: string; nonce: string } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const key = JSON.stringify(cache.key);
  async function send(
    text: string,
    options: { replyToId?: string; attachmentIds?: readonly string[] } = {},
  ): Promise<boolean> {
    if (!adapter || !canSend) return false;
    if (!options.attachmentIds?.length) {
      if (!user || !text.trim()) return false;
      const payload = adapter.payload();
      const container: OutboxContainer =
        typeof payload["channelId"] === "string"
          ? { kind: "channel", id: payload["channelId"] }
          : typeof payload["conversationId"] === "string"
            ? { kind: "direct", id: payload["conversationId"] }
            : (() => {
                throw new Error("Message container is missing");
              })();
      try {
        await messageOutbox.activate(user.id);
        await messageOutbox.enqueue(user.id, container, text, options.replyToId ?? null);
        setFailure(null);
        return true;
      } catch (error: unknown) {
        console.error("Message could not be stored locally", { error, conversation: key });
        setFailure({ key, message: t("chat.outbox.storageFailed") });
        return false;
      }
    }
    const signature = JSON.stringify({ key, text, options });
    const nonce =
      retry.current?.signature === signature ? retry.current.nonce : crypto.randomUUID();
    retry.current = { signature, nonce };
    try {
      const response: unknown = await chatSocket()
        .timeout(10_000)
        .emitWithAck(
          adapter.events.send,
          adapter.payload({ text, ...options, clientNonce: nonce }),
        );
      const ack = response as Ack<{ message: MessageView }>;
      if (!ack.ok) {
        setFailure({ key, message: ack.message });
        return false;
      }
      retry.current = null;
      setFailure(null);
      cache.insert(ack.data.message);
      return true;
    } catch (error: unknown) {
      console.error("Message send failed", { error, conversation: key, nonce });
      setFailure({ key, message: t("chat.errors.notSent") });
      return false;
    }
  }
  return { send, error: failure?.key === key ? failure.message : null };
}
