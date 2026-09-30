import type { MessageView } from "@voreli/shared";
import { useState } from "react";
import { useSession } from "../../entities/session/session.store";
import { apiFetch } from "../../shared/api/http";

export function MessageActions({ message }: { readonly message: MessageView }) {
  const userId = useSession((state) => state.user?.id);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(message.body.kind === "text" ? message.body.text : "");
  const [error, setError] = useState<string | null>(null);
  if (message.author.id !== userId || message.deletedAt || message.body.kind !== "text")
    return null;
  async function change(method: "DELETE" | "PATCH") {
    try {
      await apiFetch(`/messages/${message.id}`, {
        method,
        ...(method === "PATCH" ? { body: { text } } : {}),
      });
      setEditing(false);
      setError(null);
    } catch (error: unknown) {
      console.error("Message modification failed", { error, messageId: message.id, method });
      setError(error instanceof Error ? error.message : "Ошибка");
    }
  }
  return (
    <div className="flex gap-2 text-xs text-muted">
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void change("PATCH");
          }}
        >
          <input
            aria-label="Редактировать сообщение"
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="bg-panel text-ink"
          />
          <button type="submit">Сохранить</button>
          <button type="button" onClick={() => setEditing(false)}>
            Отмена
          </button>
        </form>
      ) : (
        <button onClick={() => setEditing(true)}>Редактировать</button>
      )}
      <button onClick={() => void change("DELETE")}>Удалить</button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
