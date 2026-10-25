import { useState } from "react";
import { useTranslation } from "react-i18next";

import { messageOutbox, OutboxStateChangedError } from "../../entities/message/message-outbox";
import type { PendingTextMessage } from "../../entities/message/outbox-storage";

export function OutboxRows({ items }: { readonly items: readonly PendingTextMessage[] }) {
  return (
    <ol className="px-5 pb-5">
      {items.map((item) => (
        <OutboxRow key={item.localId} item={item} />
      ))}
    </ol>
  );
}

function OutboxRow({ item }: { readonly item: PendingTextMessage }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const [error, setError] = useState<string | null>(null);
  const safeToChange = item.attempt === 0 || (item.state === "failed" && !item.uncertain);

  async function revise(removeReply = false): Promise<void> {
    if (!text.trim()) return;
    try {
      const updated = await messageOutbox.update(item.userId, item.localId, (current) => {
        if (!(current.attempt === 0 || (current.state === "failed" && !current.uncertain))) {
          throw new OutboxStateChangedError();
        }
        return {
          ...current,
          text: text.trim(),
          replyToId: removeReply ? null : current.replyToId,
          clientNonce: crypto.randomUUID(),
          state: "queued",
          attempt: 0,
          retryAt: null,
          uncertain: false,
          errorCode: null,
        };
      });
      if (!updated) throw new OutboxStateChangedError();
      setEditing(false);
      setError(null);
    } catch (cause: unknown) {
      console.error("Outbox draft could not be changed", { cause, localId: item.localId });
      setError(
        t(
          cause instanceof OutboxStateChangedError
            ? "chat.outbox.stateChanged"
            : "chat.outbox.storageFailed",
        ),
      );
    }
  }

  async function remove(): Promise<void> {
    if (item.uncertain && !window.confirm(t("chat.outbox.unknownDeleteWarning"))) return;
    try {
      await messageOutbox.discard(item.userId, item.localId);
    } catch (cause: unknown) {
      console.error("Outbox draft could not be removed", { cause, localId: item.localId });
      setError(
        t(
          cause instanceof OutboxStateChangedError
            ? "chat.outbox.stateChanged"
            : "chat.outbox.storageFailed",
        ),
      );
    }
  }

  return (
    <li
      id={`pending-${item.clientNonce}`}
      className="rounded-xl border border-line bg-panel px-4 py-3"
    >
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void revise();
          }}
          className="flex gap-2"
        >
          <input
            aria-label={t("chat.outbox.edit")}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="min-w-0 flex-1 rounded-lg bg-panel-raised px-2 py-1 text-sm text-ink"
          />
          <button type="submit" className="text-xs text-accent-bright">
            {t("chat.outbox.save")}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-muted">
            {t("common.cancel")}
          </button>
        </form>
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm text-ink-soft">{item.text}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
        <span role="status">{t(`chat.outbox.state.${item.state}`)}</span>
        {item.state === "unknown" && <span>{t("chat.outbox.unknownHint")}</span>}
        {safeToChange && !editing && (
          <button onClick={() => setEditing(true)} className="text-accent-bright">
            {t("chat.outbox.edit")}
          </button>
        )}
        {item.state === "failed" && safeToChange && !editing && (
          <button onClick={() => void revise()} className="text-accent-bright">
            {t("chat.outbox.retry")}
          </button>
        )}
        {item.state === "failed" && safeToChange && item.replyToId && !editing && (
          <button onClick={() => void revise(true)} className="text-accent-bright">
            {t("chat.outbox.withoutReply")}
          </button>
        )}
        {(item.state === "unknown" || item.uncertain) && (
          <button
            onClick={() => {
              void navigator.clipboard.writeText(item.text).catch((cause: unknown) => {
                console.error("Outbox text could not be copied", { cause });
                setError(t("chat.outbox.copyFailed"));
              });
            }}
            className="text-accent-bright"
          >
            {t("chat.outbox.copy")}
          </button>
        )}
        {(safeToChange || (item.uncertain && item.state !== "sending")) && (
          <button onClick={() => void remove()} className="text-danger-soft">
            {t("chat.outbox.remove")}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger-soft">
          {error}
        </p>
      )}
    </li>
  );
}
