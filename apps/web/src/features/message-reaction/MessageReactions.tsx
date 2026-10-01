import { ConversationCache } from "../../entities/message/conversation-cache";
import { useQueryClient } from "@tanstack/react-query";
import { ClientEvent, type Ack, type MessageView, type ReactionUpdatedEvent } from "@voreli/shared";
import { useState } from "react";
import { useSession } from "../../entities/session/session.store";
import { chatSocket } from "../../shared/api/socket";

export function MessageReactions({ message }: { readonly message: MessageView }) {
  const queryClient = useQueryClient();
  const userId = useSession((state) => state.user?.id);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function change(emoji: string) {
    if (!message.channelId || pending) return;
    const previous = message.reactions.find((reaction) => reaction.emoji === emoji);
    const added = !previous?.reactedByCurrentUser;
    const event = {
      channelId: message.channelId,
      messageId: message.id,
      emoji,
      added,
      changedByUserId: userId ?? "",
      count: Math.max(0, (previous?.count ?? 0) + (added ? 1 : -1)),
    };
    setPending(true);
    setError(null);
    const cache = new ConversationCache(queryClient, [
      "conversation-messages",
      userId,
      JSON.stringify({ channelId: message.channelId }),
    ]);
    const update = (event: ReactionUpdatedEvent) => cache.reaction(event, userId);
    update(event);
    try {
      const response: unknown = await chatSocket()
        .timeout(10_000)
        .emitWithAck(added ? ClientEvent.AddReaction : ClientEvent.RemoveReaction, {
          channelId: message.channelId,
          messageId: message.id,
          emoji,
        });
      const ack = response as Ack<{ reaction: ReactionUpdatedEvent }>;
      if (!ack.ok) throw new Error(ack.message);
      update(ack.data.reaction);
    } catch (error: unknown) {
      console.error("Reaction update failed", { error, messageId: message.id, emoji });
      update({
        ...event,
        count: previous?.count ?? 0,
        added: previous?.reactedByCurrentUser ?? false,
      });
      void queryClient.invalidateQueries({ queryKey: ["conversation-messages"] });
      setError(error instanceof Error ? error.message : "Не удалось изменить реакцию");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {message.reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          aria-pressed={reaction.reactedByCurrentUser}
          disabled={pending}
          onClick={() => void change(reaction.emoji)}
          className="rounded border border-line px-2 text-sm aria-pressed:bg-accent/20"
        >
          {reaction.emoji} {reaction.count}
        </button>
      ))}
      <select
        aria-label="Добавить реакцию"
        value=""
        disabled={pending}
        onChange={(event) => void change(event.target.value)}
        className="rounded bg-panel text-sm text-muted"
      >
        <option value="">＋</option>
        {["👍", "❤️", "😂", "🎉", "😮", "😢", "🔥", "👀"].map((emoji) => (
          <option key={emoji}>{emoji}</option>
        ))}
      </select>
      {error && (
        <span role="alert" className="text-xs text-danger-soft">
          {error}
        </span>
      )}
    </div>
  );
}
