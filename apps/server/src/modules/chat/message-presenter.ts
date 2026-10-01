import { Injectable } from "@nestjs/common";
import type { Message, User } from "@prisma/client";
import {
  CALL_EVENT_CONTENT_SCHEMA,
  decodeCallEventContent,
  decodeTextContent,
  TEXT_CONTENT_SCHEMA,
  type MessageView,
} from "@voreli/shared";

import { MessageReadModel, type MessageRelations } from "./message-read-model.js";

export type MessageWithAuthor = Message & { author: User };

/**
 * Turns a stored message into what a client may see, decoding the payload blob on the way.
 *
 * The blob is opaque by design (see spec 004): the only place that knows how to read
 * `contentSchema` is here, so adding attachments or ciphertext later touches one file.
 */
@Injectable()
export class MessagePresenter {
  constructor(private readonly relations: MessageReadModel) {}

  async enriched(
    message: MessageWithAuthor,
    clientNonce: string | null = null,
    userId?: string,
  ): Promise<MessageView> {
    const relations = await this.relations.load([message], userId);
    return this.toView(message, clientNonce, relations.get(message.id));
  }

  async page(
    messages: readonly MessageWithAuthor[],
    userId?: string,
  ): Promise<readonly MessageView[]> {
    const relations = await this.relations.load(messages, userId);
    return messages.map((message) =>
      this.toView(message, message.clientNonce, relations.get(message.id)),
    );
  }

  toView(
    message: MessageWithAuthor,
    clientNonce: string | null = null,
    relations?: MessageRelations,
  ): MessageView {
    if (
      message.contentSchema !== TEXT_CONTENT_SCHEMA &&
      message.contentSchema !== CALL_EVENT_CONTENT_SCHEMA
    )
      throw new Error(`Unsupported content schema for message ${message.id}`);
    const call =
      message.contentSchema === CALL_EVENT_CONTENT_SCHEMA
        ? decodeCallEventContent(message.content)
        : null;
    if (message.contentSchema === CALL_EVENT_CONTENT_SCHEMA && !call)
      throw new Error(`Invalid call content for message ${message.id}`);
    return {
      id: message.id,
      channelId: message.channelId,
      directConversationId: message.directConversationId,
      author: {
        id: message.author.id,
        username: message.author.username,
        displayName: message.author.displayName,
        avatarUrl: message.author.avatarUrl,
      },
      body: call
        ? { kind: "call", call }
        : { kind: "text", text: message.deletedAt ? "" : decodeTextContent(message.content) },
      deletedAt: message.deletedAt?.toISOString() ?? null,
      reply: relations?.reply ?? null,
      attachments: relations?.attachments ?? [],
      reactions: relations?.reactions ?? [],
      replyToId: message.replyToId,
      createdAt: message.createdAt.toISOString(),
      editedAt: message.editedAt?.toISOString() ?? null,
      clientNonce,
    };
  }
}
