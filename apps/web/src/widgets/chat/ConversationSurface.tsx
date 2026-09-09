import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ConversationChat } from "../../features/send-message/useRealtimeConversation";
import { Icon } from "../../shared/ui/Icon";
import { MessageSkeleton, MessageTimeline } from "./MessageTimeline";

interface ConversationSurfaceProps {
  readonly ariaLabel: string;
  readonly icon: "hash" | "message";
  readonly title: string;
  readonly subtitle: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly messageLabel: string;
  readonly placeholder: string;
  readonly chat: ConversationChat;
}

export function ConversationSurface(props: ConversationSurfaceProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const { messages, typing, loading, error, canSend, send, notifyTyping } = props.chat;

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSend) return;
    const text = draft.trim();
    if (text.length === 0) return;
    setDraft("");
    await send(text);
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={props.ariaLabel}>
      <header className="flex min-h-16 items-center border-b border-line bg-canvas/80 px-6 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-panel-raised text-accent-bright">
            <Icon name={props.icon} className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold text-ink">{props.title}</h1>
            <p className="max-w-2xl truncate text-xs text-muted">{props.subtitle}</p>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <MessageSkeleton />
        ) : messages.length === 0 ? (
          <div className="flex min-h-full items-end px-7 py-8">
            <div className="max-w-lg">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-panel-raised text-accent-bright">
                <Icon name={props.icon} className="h-6 w-6" />
              </span>
              <h2 className="mt-5 text-2xl font-bold tracking-[-0.03em] text-ink">
                {props.emptyTitle}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">{props.emptyDescription}</p>
            </div>
          </div>
        ) : (
          <MessageTimeline messages={messages} />
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
            role="alert"
            className="mb-2 rounded-xl border border-danger/20 bg-danger/8 px-3 py-2 text-xs text-danger-soft"
          >
            {error}
          </p>
        )}
        <form onSubmit={(event) => void submit(event)} className="pb-5">
          <div className="flex min-h-12 items-center gap-2 rounded-2xl border border-line bg-panel-raised p-1.5 shadow-[0_10px_28px_rgba(0,0,0,.14)] transition focus-within:border-accent/50 focus-within:bg-panel-hover">
            <label htmlFor="message-draft" className="sr-only">
              {props.messageLabel}
            </label>
            <input
              id="message-draft"
              disabled={!canSend}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                notifyTyping();
              }}
              placeholder={props.placeholder}
              className="min-w-0 flex-1 bg-transparent px-3 text-sm text-ink outline-none placeholder:text-faint"
            />
            <button
              type="submit"
              disabled={!canSend || draft.trim().length === 0}
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
