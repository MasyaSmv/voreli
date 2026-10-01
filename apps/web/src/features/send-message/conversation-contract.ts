import type { MessagePage, MessageView } from "@voreli/shared";

export interface RealtimeConversationAdapter {
  readonly events: {
    readonly subscribe: string;
    readonly unsubscribe: string;
    readonly send: string;
    readonly typingStart: string;
    readonly messageNew: string;
    readonly messageUpdated: string;
    readonly messageDeleted: string;
    readonly typing: string;
    readonly accessRevoked: string;
    readonly markRead?: string;
  };
  fetchHistory(before?: string): Promise<MessagePage>;
  payload(extra?: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;
  messageBelongs(message: MessageView): boolean;
  deletedMessageId(event: unknown): string | null;
  typingDescriptor(event: unknown): {
    readonly key: string;
    readonly name: string;
    readonly until: string;
  } | null;
  accessWasRevoked(event: unknown): boolean;
  invalidate(): readonly ReadonlyArray<unknown>[];
  readonly retainMessagesOnRevoke: boolean;
  readonly historyError: string;
  readonly revokedError: string;
}

export interface ConversationChat {
  readonly messages: readonly MessageView[];
  readonly typing: readonly string[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly canSend: boolean;
  readonly send: (
    text: string,
    options?: { replyToId?: string; attachmentIds?: readonly string[] },
  ) => Promise<boolean>;
  readonly loadOlder: () => Promise<void>;
  readonly hasOlder: boolean;
  readonly reveal: (messageId: string) => Promise<void>;
  readonly notifyTyping: () => void;
}
