import type { ChannelView, MessageView } from "@voreli/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useChannelChat } from "../../features/send-message/useChannelChat";
import { Avatar } from "../../shared/ui/Avatar";
import { Icon } from "../../shared/ui/Icon";

interface ChatPanelProps {
  readonly channel: ChannelView | null;
}

export function ChatPanel({ channel }: ChatPanelProps) {
  const { t, i18n } = useTranslation();
  const { messages, typing, loading, error, send, notifyTyping } = useChannelChat(
    channel?.id ?? null,
  );
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (channel === null) {
    return <WorkspaceWelcome />;
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const text = draft.trim();

    if (text.length === 0) {
      return;
    }

    setDraft("");
    await send(text);
  }

  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      aria-label={t("chat.channelLabel", { channel: channel.name })}
    >
      <header className="flex min-h-16 items-center border-b border-line bg-canvas/80 px-6 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-panel-raised text-accent-bright">
            <Icon name="hash" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold text-ink">{channel.name}</h1>
            {channel.topic === null ? (
              <p className="text-xs text-faint">{t("chat.textChannel")}</p>
            ) : (
              <p className="max-w-2xl truncate text-xs text-muted">{channel.topic}</p>
            )}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <MessageSkeleton />
        ) : messages.length === 0 ? (
          <EmptyChannel channelName={channel.name} />
        ) : (
          <ol className="px-5 py-5">
            {messages.map((message) => (
              <MessageRow key={message.id} message={message} locale={i18n.resolvedLanguage} />
            ))}
          </ol>
        )}
        <div ref={bottom} />
      </div>

      <div className="px-5">
        <div className="h-6 text-xs text-muted">
          {typing.length === 0 ? null : (
            <span data-testid="typing-indicator">
              <strong className="font-semibold text-ink-soft">{typing.join(", ")}</strong>{" "}
              {t("chat.typing", { count: typing.length })}…
            </span>
          )}
        </div>

        {error === null ? null : (
          <p
            data-testid="chat-error"
            role="alert"
            className="mb-2 rounded-xl border border-danger/20 bg-danger/8 px-3 py-2 text-xs text-danger-soft"
          >
            {error}
          </p>
        )}

        <form onSubmit={(event) => void submit(event)} className="pb-5">
          <div className="flex min-h-12 items-center gap-2 rounded-2xl border border-line bg-panel-raised p-1.5 shadow-[0_10px_28px_rgba(0,0,0,.14)] transition focus-within:border-accent/50 focus-within:bg-panel-hover">
            <label htmlFor="message-draft" className="sr-only">
              {t("chat.messageLabel", { channel: channel.name })}
            </label>
            <input
              id="message-draft"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                notifyTyping();
              }}
              placeholder={t("chat.messagePlaceholder", { channel: channel.name })}
              className="min-w-0 flex-1 bg-transparent px-3 text-sm text-ink outline-none placeholder:text-faint"
            />
            <button
              type="submit"
              disabled={draft.trim().length === 0}
              aria-label={t("chat.send")}
              title={t("chat.sendTitle")}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-white transition hover:bg-accent-bright disabled:cursor-not-allowed disabled:bg-line disabled:text-faint"
            >
              <Icon name="send" className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function MessageRow({
  message,
  locale,
}: {
  readonly message: MessageView;
  readonly locale: string | undefined;
}) {
  return (
    <li className="group flex gap-3 rounded-xl px-2 py-2.5 transition hover:bg-panel/55">
      <Avatar name={message.author.displayName} url={message.author.avatarUrl} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-ink">
            {message.author.displayName}
          </span>
          <time className="shrink-0 text-[10px] text-faint" dateTime={message.createdAt}>
            {formatTime(message.createdAt, locale)}
          </time>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-6 text-ink-soft">
          {message.text}
        </p>
      </div>
    </li>
  );
}

function EmptyChannel({ channelName }: { readonly channelName: string }) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-full items-end px-7 py-8">
      <div className="max-w-lg">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-panel-raised text-accent-bright">
          <Icon name="hash" className="h-6 w-6" />
        </span>
        <h2 className="mt-5 text-2xl font-bold tracking-[-0.03em] text-ink">
          {t("chat.emptyTitle", { channel: channelName })}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted">{t("chat.emptyDescription")}</p>
      </div>
    </div>
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

function MessageSkeleton() {
  const { t } = useTranslation();

  return (
    <div className="space-y-5 px-7 py-7" aria-label={t("chat.loadingHistory")}>
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="flex animate-pulse gap-3">
          <div className="h-9 w-9 rounded-[35%] bg-panel-hover" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-28 rounded bg-panel-hover" />
            <div className="h-3 max-w-md rounded bg-panel-raised" />
          </div>
        </div>
      ))}
    </div>
  );
}

function formatTime(value: string, locale: string | undefined): string {
  return new Date(value).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
