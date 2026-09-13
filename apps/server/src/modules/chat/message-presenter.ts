import { Injectable } from "@nestjs/common";
import type { Message, User } from "@prisma/client";
import {
  CALL_EVENT_CONTENT_SCHEMA,
  decodeCallEventContent,
  decodeTextContent,
  type MessageView,
} from "@voreli/shared";

export type MessageWithAuthor = Message & { author: User };

/**
 * Turns a stored message into what a client may see, decoding the payload blob on the way.
 *
 * The blob is opaque by design (see spec 004): the only place that knows how to read
 * `contentSchema` is here, so adding attachments or ciphertext later touches one file.
 */
@Injectable()
export class MessagePresenter {
  toView(message: MessageWithAuthor, clientNonce: string | null = null): MessageView {
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
      text:
        message.contentSchema === CALL_EVENT_CONTENT_SCHEMA
          ? ""
          : decodeTextContent(message.content),
      contentSchema: message.contentSchema,
      callEvent:
        message.contentSchema === CALL_EVENT_CONTENT_SCHEMA
          ? decodeCallEventContent(message.content)
          : null,
      replyToId: message.replyToId,
      createdAt: message.createdAt.toISOString(),
      editedAt: message.editedAt?.toISOString() ?? null,
      clientNonce,
    };
  }
}
