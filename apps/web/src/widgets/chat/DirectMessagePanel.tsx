import type { DirectConversationView } from "@voreli/shared";
import { useTranslation } from "react-i18next";

import { useDirectChat } from "../../features/send-message/useDirectChat";
import { ConversationSurface } from "./ConversationSurface";

export function DirectMessagePanel({
  conversation,
}: {
  readonly conversation: DirectConversationView;
}) {
  const { t } = useTranslation();
  const chat = useDirectChat(conversation.id);
  return (
    <ConversationSurface
      ariaLabel={t("direct.label", { name: conversation.participant.displayName })}
      icon="message"
      title={conversation.participant.displayName}
      subtitle={`@${conversation.participant.username}`}
      emptyTitle={t("direct.emptyTitle", { name: conversation.participant.displayName })}
      emptyDescription={t("direct.emptyDescription")}
      messageLabel={t("direct.messageLabel", { name: conversation.participant.displayName })}
      placeholder={t("direct.messagePlaceholder", { name: conversation.participant.displayName })}
      chat={chat}
    />
  );
}
