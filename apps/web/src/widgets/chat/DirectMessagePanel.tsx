import type { DirectConversationView } from "@voreli/shared";
import { useTranslation } from "react-i18next";

import { useDirectChat } from "../../features/send-message/useDirectChat";
import { directCallSession } from "../../features/direct-call/direct-call-session";
import { useDirectCall } from "../../entities/direct-call/direct-call.store";
import { Icon } from "../../shared/ui/Icon";
import { ConversationSurface } from "./ConversationSurface";

export function DirectMessagePanel({
  conversation,
}: {
  readonly conversation: DirectConversationView;
}) {
  const { t } = useTranslation();
  const chat = useDirectChat(conversation.id);
  const activeCall = useDirectCall((state) => state.call);
  const callError = useDirectCall((state) => state.error);
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
      headerActions={
        conversation.participant.capabilities.canCall ? (
          <div className="flex items-center gap-2">
            {callError && activeCall === null ? (
              <span role="alert" className="max-w-48 text-xs text-danger-soft">
                {callError}
              </span>
            ) : null}
            <button
              type="button"
              disabled={activeCall !== null}
              onClick={() => void directCallSession.start(conversation.id).catch(() => undefined)}
              aria-label={t("call.start", { name: conversation.participant.displayName })}
              title={
                activeCall
                  ? t("call.inProgress")
                  : t("call.start", { name: conversation.participant.displayName })
              }
              className="grid min-h-11 min-w-11 place-items-center rounded-xl bg-voice/10 text-voice transition hover:bg-voice/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="phone" className="h-4 w-4" />
            </button>
          </div>
        ) : null
      }
    />
  );
}
