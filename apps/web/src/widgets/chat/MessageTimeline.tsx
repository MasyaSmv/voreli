import type { MessageView } from "@voreli/shared";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";

import {
  formatMessageDay,
  formatMessageTime,
  formatMessageTimestamp,
  sameLocalDay,
} from "../../shared/lib/message-date";
import { formatCallDuration } from "../../shared/lib/call-duration";
import { Avatar } from "../../shared/ui/Avatar";

export function MessageTimeline({ messages }: { readonly messages: readonly MessageView[] }) {
  const { i18n } = useTranslation();
  return (
    <ol className="px-5 py-5">
      {messages.map((message, index) => (
        <Fragment key={message.id}>
          {index === 0 || !sameLocalDay(messages[index - 1]?.createdAt ?? "", message.createdAt) ? (
            <MessageDay value={message.createdAt} locale={i18n.resolvedLanguage} />
          ) : null}
          <MessageRow message={message} locale={i18n.resolvedLanguage} />
        </Fragment>
      ))}
    </ol>
  );
}

function MessageRow({
  message,
  locale,
}: {
  readonly message: MessageView;
  readonly locale: string | undefined;
}) {
  if (message.callEvent) return <CallHistoryRow message={message} locale={locale} />;

  return (
    <li className="group flex gap-3 rounded-xl px-2 py-2.5 transition hover:bg-panel/55">
      <Avatar name={message.author.displayName} url={message.author.avatarUrl} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-ink">
            {message.author.displayName}
          </span>
          <time
            className="shrink-0 text-[10px] text-faint"
            dateTime={message.createdAt}
            title={formatMessageTimestamp(message.createdAt, locale)}
          >
            {formatMessageTime(message.createdAt, locale)}
          </time>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-6 text-ink-soft">
          {message.text}
        </p>
      </div>
    </li>
  );
}

function CallHistoryRow({
  message,
  locale,
}: {
  readonly message: MessageView;
  readonly locale: string | undefined;
}) {
  const { t } = useTranslation();
  const event = message.callEvent;
  if (!event) return null;
  const label =
    event.outcome === "completed"
      ? t("call.history.completed", { duration: formatCallDuration(event.durationSeconds ?? 0) })
      : t(`call.history.${event.outcome}`);
  return (
    <li className="flex items-center gap-3 px-2 py-3 text-xs text-muted">
      <span className="h-px flex-1 bg-line" />
      <span title={formatMessageTimestamp(message.createdAt, locale)}>{label}</span>
      <span className="h-px flex-1 bg-line" />
    </li>
  );
}

function MessageDay({
  value,
  locale,
}: {
  readonly value: string;
  readonly locale: string | undefined;
}) {
  return (
    <li className="relative my-4 flex items-center justify-center" role="separator">
      <span className="absolute inset-x-0 h-px bg-line" />
      <time
        dateTime={value.slice(0, 10)}
        className="relative rounded-full border border-line bg-canvas px-3 py-1 text-[10px] font-semibold text-muted"
      >
        {formatMessageDay(value, locale)}
      </time>
    </li>
  );
}

export function MessageSkeleton() {
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
