import type { QueryClient } from "@tanstack/react-query";
import type { MessagePage, MessageView, ReactionUpdatedEvent } from "@voreli/shared";

export class ConversationCache {
  constructor(
    private readonly client: QueryClient,
    readonly key: readonly unknown[],
  ) {}
  page(): MessagePage | undefined {
    return this.client.getQueryData<MessagePage>(this.key);
  }
  clear(): void {
    this.client.setQueryData<MessagePage>(this.key, { messages: [], nextCursor: null });
  }
  insert(message: MessageView): void {
    this.change((messages) => {
      const matches = (item: MessageView) =>
        item.id === message.id ||
        (item.author.id === message.author.id &&
          message.clientNonce !== null &&
          item.clientNonce === message.clientNonce);
      return messages.some(matches)
        ? messages.map((item) => (matches(item) ? message : item))
        : [...messages, message];
    });
  }
  optimistic(message: MessageView): void {
    if (
      this.page()?.messages.some(
        (item) => item.author.id === message.author.id && item.clientNonce === message.clientNonce,
      )
    )
      return;
    this.insert(message);
  }
  discardPending(nonce: string): void {
    this.change((messages) => messages.filter((item) => item.id !== `pending:${nonce}`));
  }
  update(message: MessageView): void {
    this.change((messages) =>
      messages.map((item) =>
        item.id === message.id
          ? {
              ...message,
              reactions: message.reactions.map((reaction) => ({
                ...reaction,
                reactedByCurrentUser:
                  item.reactions.find((previous) => previous.emoji === reaction.emoji)
                    ?.reactedByCurrentUser ?? false,
              })),
            }
          : item.reply?.id === message.id
            ? {
                ...item,
                reply: {
                  ...item.reply,
                  textPreview: preview(
                    message.body.kind === "text"
                      ? message.body.text || message.attachments[0]?.name || ""
                      : "",
                  ),
                  deleted: message.deletedAt !== null,
                },
              }
            : item,
      ),
    );
  }
  remove(messageId: string): void {
    this.change((messages) =>
      messages.map((item) =>
        item.id === messageId
          ? {
              ...item,
              body: { kind: "text", text: "" },
              deletedAt: new Date().toISOString(),
              reply: null,
              attachments: [],
              reactions: [],
            }
          : item.reply?.id === messageId
            ? { ...item, reply: { ...item.reply, deleted: true, textPreview: "" } }
            : item,
      ),
    );
  }
  reaction(event: ReactionUpdatedEvent, userId: string | undefined): void {
    this.change((messages) =>
      messages.map((message) => {
        if (message.id !== event.messageId || message.deletedAt) return message;
        const previous = message.reactions.find((reaction) => reaction.emoji === event.emoji);
        const reactions = message.reactions.filter((reaction) => reaction.emoji !== event.emoji);
        if (event.count > 0)
          reactions.push({
            emoji: event.emoji,
            count: event.count,
            reactedByCurrentUser:
              event.changedByUserId === userId
                ? event.added
                : (previous?.reactedByCurrentUser ?? false),
          });
        return { ...message, reactions };
      }),
    );
  }
  prepend(older: MessagePage): void {
    this.client.setQueryData<MessagePage>(this.key, (latest) => ({
      nextCursor: older.nextCursor,
      messages: [...older.messages]
        .reverse()
        .filter((item) => !latest?.messages.some((existing) => existing.id === item.id))
        .concat([...(latest?.messages ?? [])]),
    }));
  }
  private change(change: (messages: readonly MessageView[]) => readonly MessageView[]): void {
    this.client.setQueryData<MessagePage>(this.key, (page) => ({
      nextCursor: page?.nextCursor ?? null,
      messages: change(page?.messages ?? []),
    }));
  }
}

function preview(text: string): string {
  return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text))
    .slice(0, 120)
    .map((part) => part.segment)
    .join("");
}
