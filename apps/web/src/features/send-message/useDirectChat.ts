import { ClientEvent, ServerEvent, type MessageView } from "@voreli/shared";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { fetchDirectHistory } from "../../entities/direct-conversation/direct-conversation.api";
import { useDirectCall } from "../../entities/direct-call/direct-call.store";
import { stringField, useRealtimeConversation } from "./useRealtimeConversation";

export function useDirectChat(conversationId: string | null) {
  const { t } = useTranslation();
  const callHistoryRevision = useDirectCall((state) =>
    state.lastEndedConversationId === conversationId ? state.historyRevision : 0,
  );
  const adapter = useMemo(
    () =>
      conversationId === null
        ? null
        : {
            events: {
              subscribe: ClientEvent.DirectSubscribe,
              unsubscribe: ClientEvent.DirectUnsubscribe,
              send: ClientEvent.DirectSendMessage,
              typingStart: ClientEvent.DirectTypingStart,
              messageNew: ServerEvent.DirectMessageNew,
              messageUpdated: ServerEvent.DirectMessageUpdated,
              messageDeleted: ServerEvent.DirectMessageDeleted,
              typing: ServerEvent.DirectTyping,
              accessRevoked: ServerEvent.DirectAccessRevoked,
              markRead: ClientEvent.DirectMarkRead,
            },
            fetchHistory: () => fetchDirectHistory(conversationId),
            payload: (extra = {}) => ({ conversationId, ...extra }),
            messageBelongs: (message: MessageView) =>
              message.directConversationId === conversationId,
            deletedMessageId: (event: unknown) =>
              stringField(event, "conversationId") === conversationId
                ? stringField(event, "messageId")
                : null,
            typingDescriptor: (event: unknown) =>
              stringField(event, "conversationId") === conversationId
                ? {
                    key: stringField(event, "username") ?? "unknown",
                    name: stringField(event, "displayName") ?? "",
                    until: stringField(event, "until") ?? new Date().toISOString(),
                  }
                : null,
            accessWasRevoked: (event: unknown) =>
              stringField(event, "conversationId") === conversationId,
            invalidate: () => [["direct-conversations"], ["relationships"]],
            retainMessagesOnRevoke: true,
            refreshKey: callHistoryRevision,
            historyError: t("direct.errors.history"),
            revokedError: t("direct.errors.accessRevoked"),
          },
    [callHistoryRevision, conversationId, t],
  );

  return useRealtimeConversation(adapter);
}
