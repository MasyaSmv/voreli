/**
 * Realtime chat contract. Both halves of every event live here so the client cannot emit a
 * payload the server does not read, and the server cannot rename a field without breaking
 * the client's build.
 */
export const CHAT_NAMESPACE = "/chat";

/** Events the client sends. */
export const ClientEvent = {
  Subscribe: "channel:subscribe",
  Unsubscribe: "channel:unsubscribe",
  SendMessage: "message:send",
  TypingStart: "typing:start",
  MarkRead: "channel:read",
  RefreshAuth: "auth:refresh",
} as const;

/** Events the server sends. */
export const ServerEvent = {
  MessageNew: "message:new",
  MessageUpdated: "message:updated",
  MessageDeleted: "message:deleted",
  Typing: "typing",
  Error: "error",
} as const;

export const MESSAGE_MAX_LENGTH = 4000;
/** How long a "typing" indicator stays lit without a refresh. */
export const TYPING_TTL_MS = 5000;
export const MESSAGE_PAGE_SIZE = 50;
export const MESSAGE_PAGE_MAX_SIZE = 100;

/** Author as embedded in a message; the full profile is fetched separately. */
export interface MessageAuthor {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
}

export interface MessageView {
  readonly id: string;
  readonly channelId: string;
  readonly author: MessageAuthor;
  readonly text: string;
  readonly replyToId: string | null;
  readonly createdAt: string;
  readonly editedAt: string | null;
  /**
   * Echoed back from the sender's request so an optimistically rendered message is replaced
   * rather than duplicated when the server's copy arrives.
   */
  readonly clientNonce: string | null;
}

export interface SubscribePayload {
  readonly channelId: string;
}

export interface SendMessagePayload {
  readonly channelId: string;
  readonly text: string;
  readonly replyToId?: string;
  readonly clientNonce?: string;
}

export interface TypingPayload {
  readonly channelId: string;
}

export interface MarkReadPayload {
  readonly channelId: string;
  readonly messageId: string;
}

export interface RefreshAuthPayload {
  readonly accessToken: string;
}

export interface TypingEvent {
  readonly channelId: string;
  readonly userId: string;
  readonly displayName: string;
  /** Wall-clock ISO time after which the indicator should disappear on its own. */
  readonly until: string;
}

export interface MessageDeletedEvent {
  readonly channelId: string;
  readonly messageId: string;
}

export interface SocketErrorEvent {
  readonly errorCode: string;
  readonly message: string;
}

/** Acknowledgement shape for client-to-server events that expect an answer. */
export type Ack<T> = { readonly ok: true; readonly data: T } | { readonly ok: false } & SocketErrorEvent;

export const CHAT_ROUTES = {
  messages: (channelId: string) => `/channels/${channelId}/messages`,
  message: (messageId: string) => `/messages/${messageId}`,
  unread: (serverId: string) => `/servers/${serverId}/unread`,
} as const;

export interface MessagePage {
  readonly messages: readonly MessageView[];
  /** Cursor to pass as `before` for the next, older page. Null when history is exhausted. */
  readonly nextCursor: string | null;
}

export interface UnreadCount {
  readonly channelId: string;
  readonly count: number;
}

export interface UnreadResponse {
  readonly channels: readonly UnreadCount[];
}

/**
 * The stored payload of a message. Today it holds text; attachments (M4) add fields here,
 * and end-to-end encryption (M7) replaces the whole blob with ciphertext — in both cases
 * without migrating the column or the history in it.
 */
export const TEXT_CONTENT_SCHEMA = "text/v1";

export interface TextContentV1 {
  readonly text: string;
}

export function encodeTextContent(text: string): Uint8Array {
  const payload: TextContentV1 = { text };

  return new TextEncoder().encode(JSON.stringify(payload));
}

export function decodeTextContent(bytes: Uint8Array): string {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));

  if (typeof parsed !== "object" || parsed === null) {
    return "";
  }

  const text = (parsed as Record<string, unknown>)["text"];

  return typeof text === "string" ? text : "";
}
