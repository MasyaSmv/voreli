import type { ChannelView, MessageView } from "@voreli/shared";
import { useEffect, useRef, useState } from "react";

import { useChannelChat } from "../../features/send-message/useChannelChat";

interface ChatPanelProps {
  readonly channel: ChannelView | null;
}

export function ChatPanel({ channel }: ChatPanelProps) {
  const { messages, typing, loading, error, send, notifyTyping } = useChannelChat(
    channel?.id ?? null,
  );
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (channel === null) {
    return (
      <section className="flex flex-1 items-center justify-center text-sm text-white/40">
        Выберите канал
      </section>
    );
  }

  if (channel.type === "VOICE") {
    return (
      <section className="flex flex-1 items-center justify-center text-sm text-white/40">
        Голосовые каналы появятся на следующем этапе
      </section>
    );
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
    <section className="flex flex-1 flex-col">
      <header className="border-b border-white/10 px-6 py-3">
        <h2 className="text-sm font-medium text-white">#{channel.name}</h2>
        {channel.topic === null ? null : (
          <p className="mt-0.5 text-xs text-white/40">{channel.topic}</p>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <p className="text-sm text-white/40">Загружаем историю…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-white/40">Здесь пока пусто. Напишите первым.</p>
        ) : (
          <ol className="space-y-3">
            {messages.map((message) => (
              <MessageRow key={message.id} message={message} />
            ))}
          </ol>
        )}
        <div ref={bottom} />
      </div>

      <div className="h-5 px-6 text-xs text-white/40">
        {typing.length === 0 ? null : (
          <span data-testid="typing-indicator">
            {typing.join(", ")} {typing.length === 1 ? "печатает" : "печатают"}…
          </span>
        )}
      </div>

      {error === null ? null : (
        <p data-testid="chat-error" className="px-6 pb-2 text-xs text-red-300">
          {error}
        </p>
      )}

      <form onSubmit={(event) => void submit(event)} className="border-t border-white/10 p-4">
        <input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            notifyTyping();
          }}
          placeholder={`Сообщение в #${channel.name}`}
          className="w-full rounded-lg border border-white/10 bg-neutral-900 px-4 py-2 text-sm text-white outline-none focus:border-white/30"
        />
      </form>
    </section>
  );
}

function MessageRow({ message }: { readonly message: MessageView }) {
  return (
    <li className="text-sm">
      <span className="mr-2 font-medium text-white">{message.author.displayName}</span>
      <time className="text-xs text-white/30" dateTime={message.createdAt}>
        {new Date(message.createdAt).toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </time>
      <p className="mt-0.5 whitespace-pre-wrap break-words text-white/80">{message.text}</p>
    </li>
  );
}
