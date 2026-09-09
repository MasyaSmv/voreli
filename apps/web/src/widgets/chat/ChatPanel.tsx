import type { ChannelView } from "@voreli/shared";
import { useTranslation } from "react-i18next";

import { useChannelChat } from "../../features/send-message/useChannelChat";
import { Icon } from "../../shared/ui/Icon";
import { ConversationSurface } from "./ConversationSurface";

export function ChatPanel({ channel }: { readonly channel: ChannelView | null }) {
  const { t } = useTranslation();
  const chat = useChannelChat(channel?.id ?? null);

  if (channel === null) return <WorkspaceWelcome />;

  return (
    <ConversationSurface
      ariaLabel={t("chat.channelLabel", { channel: channel.name })}
      icon="hash"
      title={channel.name}
      subtitle={channel.topic ?? t("chat.textChannel")}
      emptyTitle={t("chat.emptyTitle", { channel: channel.name })}
      emptyDescription={t("chat.emptyDescription")}
      messageLabel={t("chat.messageLabel", { channel: channel.name })}
      placeholder={t("chat.messagePlaceholder", { channel: channel.name })}
      chat={chat}
    />
  );
}

function WorkspaceWelcome() {
  const { t } = useTranslation();
  return (
    <section className="grid flex-1 place-items-center overflow-hidden p-8">
      <div className="relative max-w-md text-center">
        <div className="absolute left-1/2 top-1/2 -z-10 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/8 blur-3xl" />
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-[1.4rem] border border-line bg-panel text-accent-bright shadow-xl">
          <Icon name="spark" className="h-7 w-7" />
        </span>
        <h1 className="mt-6 text-2xl font-bold tracking-[-0.035em] text-ink">
          {t("workspace.welcomeTitle")}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted">{t("workspace.welcomeDescription")}</p>
      </div>
    </section>
  );
}
