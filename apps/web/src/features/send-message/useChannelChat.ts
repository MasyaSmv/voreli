import { ClientEvent, ServerEvent, type MessageView } from "@voreli/shared";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { fetchHistory } from "../../entities/message/message.api";
import { stringField, useRealtimeConversation } from "./useRealtimeConversation";

export function useChannelChat(channelId: string | null) {
  const { t } = useTranslation();
  const adapter = useMemo(
    () =>
      channelId === null
        ? null
        : {
            events: {
              subscribe: ClientEvent.Subscribe,
              unsubscribe: ClientEvent.Unsubscribe,
              send: ClientEvent.SendMessage,
              typingStart: ClientEvent.TypingStart,
              messageNew: ServerEvent.MessageNew,
              messageUpdated: ServerEvent.MessageUpdated,
              messageDeleted: ServerEvent.MessageDeleted,
              typing: ServerEvent.Typing,
              accessRevoked: ServerEvent.ChannelAccessRevoked,
            },
            fetchHistory: () => fetchHistory(channelId),
            payload: (extra = {}) => ({ channelId, ...extra }),
            messageBelongs: (message: MessageView) => message.channelId === channelId,
            deletedMessageId: (event: unknown) =>
              stringField(event, "channelId") === channelId
                ? stringField(event, "messageId")
                : null,
            typingDescriptor: (event: unknown) =>
              stringField(event, "channelId") === channelId
                ? {
                    key: stringField(event, "userId") ?? "unknown",
                    name: stringField(event, "displayName") ?? "",
                    until: stringField(event, "until") ?? new Date().toISOString(),
                  }
                : null,
            accessWasRevoked: (event: unknown) => stringField(event, "channelId") === channelId,
            invalidate: () => [["server"], ["unread"]],
            retainMessagesOnRevoke: false,
            historyError: t("chat.errors.history"),
            revokedError: t("chat.errors.accessRevoked"),
          },
    [channelId, t],
  );

  return useRealtimeConversation(adapter);
}
