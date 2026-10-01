import { useAttachmentDrafts } from "../../features/attachment-upload/useAttachmentDrafts";
import type { MessageView } from "@voreli/shared";
import { AttachmentDrafts } from "../../features/attachment-upload/AttachmentDrafts";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { ConversationChat } from "../../features/send-message/useRealtimeConversation";
import { Icon } from "../../shared/ui/Icon";
import { MessageSkeleton, MessageTimeline } from "./MessageTimeline";

interface ConversationSurfaceProps {
  readonly rich?: boolean;
  readonly ariaLabel: string;
  readonly icon: "hash" | "message";
  readonly title: string;
  readonly subtitle: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly messageLabel: string;
  readonly placeholder: string;
  readonly chat: ConversationChat;
  readonly headerActions?: ReactNode;
}

export function ConversationSurface(props: ConversationSurfaceProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [reply, setReply] = useState<MessageView | null>(null);
  const [sending, setSending] = useState(false);
  const attachments = useAttachmentDrafts();
  const bottom = useRef<HTMLDivElement>(null);
  const { messages, typing, loading, error, canSend, send, notifyTyping } = props.chat;

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSend) return;
    const text = draft.trim();
    if ((!text && !attachments.items.length) || !attachments.ready || sending) return;
    setSending(true);
    try {
      if (
        await send(text, {
          ...(reply ? { replyToId: reply.id } : {}),
          ...(attachments.items.length ? { attachmentIds: attachments.uploadIds } : {}),
        })
      ) {
        setDraft("");
        setReply(null);
        attachments.clear();
      }
    } catch (error: unknown) {
      console.error("Message send failed", { error });
    } finally {
      setSending(false);
    }
  }

  return (
    <section
      onDragOver={(event) => {
        if (props.rich) event.preventDefault();
      }}
      onDrop={(event) => {
        if (props.rich) {
          event.preventDefault();
          attachments.add(Array.from(event.dataTransfer.files));
        }
      }}
      className="flex min-h-0 flex-1 flex-col"
      aria-label={props.ariaLabel}
    >
      <header className="flex min-h-16 items-center justify-between gap-3 border-b border-line bg-canvas/80 px-6 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-panel-raised text-accent-bright">
            <Icon name={props.icon} className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold text-ink">{props.title}</h1>
            <p className="max-w-2xl truncate text-xs text-muted">{props.subtitle}</p>
          </div>
        </div>
        {props.headerActions}
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
          <>
            {props.chat.hasOlder && (
              <button
                onClick={() => void props.chat.loadOlder()}
                className="px-5 py-2 text-sm text-muted"
              >
                Ранее
              </button>
            )}
            <MessageTimeline
              messages={messages}
              onReply={props.rich ? setReply : undefined}
              onReveal={props.chat.reveal}
            />
          </>
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
        {reply && (
          <div className="text-xs text-muted">
            Ответ {reply.author.displayName}
            <button onClick={() => setReply(null)}> × </button>
          </div>
        )}
        <AttachmentDrafts items={attachments.items} remove={attachments.remove} />
        <form onSubmit={(event) => void submit(event)} className="pb-5">
          <div className="flex min-h-12 items-center gap-2 rounded-2xl border border-line bg-panel-raised p-1.5 shadow-[0_10px_28px_rgba(0,0,0,.14)] transition focus-within:border-accent/50 focus-within:bg-panel-hover">
            <label htmlFor="message-draft" className="sr-only">
              {props.messageLabel}
            </label>
            {props.rich && (
              <label className="cursor-pointer px-2 text-muted" aria-label="Прикрепить файл">
                ＋
                <input
                  type="file"
                  multiple
                  className="sr-only"
                  aria-label="Прикрепить файл"
                  onChange={(event) => {
                    attachments.add(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                />
              </label>
            )}
            <input
              onPaste={(event) => {
                if (props.rich && event.clipboardData.files.length) {
                  event.preventDefault();
                  attachments.add(Array.from(event.clipboardData.files));
                }
              }}
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
              disabled={
                !canSend ||
                sending ||
                !attachments.ready ||
                (draft.trim().length === 0 && attachments.items.length === 0)
              }
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
