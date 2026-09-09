import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { encodeTextContent, TEXT_CONTENT_SCHEMA } from "@voreli/shared";

import { ID_GENERATOR, type IdGenerator } from "../../common/services/id-generator.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import { ResourceNotVisibleError } from "../permissions/errors/permission-errors.js";
import { ContactPolicyService } from "../relationships/contact-policy.service.js";
import { DirectConversationService } from "../relationships/direct-conversation.service.js";
import { NotATextChannelError, ReplyTargetNotInChannelError } from "./errors/chat-errors.js";
import { ChatBroadcaster } from "./chat-broadcaster.js";
import { MessagePresenter, type MessageWithAuthor } from "./message-presenter.js";
import { MessageHistoryService } from "./message-history.service.js";

export interface SendMessageInput {
  readonly channelId: string;
  readonly authorId: string;
  readonly text: string;
  readonly replyToId?: string | undefined;
}

export interface SendDirectMessageInput {
  readonly conversationId: string;
  readonly authorId: string;
  readonly text: string;
  readonly replyToId?: string | undefined;
  readonly clientNonce?: string | undefined;
}

@Injectable()
export class MessageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presenter: MessagePresenter,
    private readonly broadcaster: ChatBroadcaster,
    private readonly directConversations: DirectConversationService,
    private readonly contactPolicy: ContactPolicyService,
    private readonly history: MessageHistoryService,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async send(input: SendMessageInput): Promise<MessageWithAuthor> {
    const channel = await this.prisma.db.channel.findUnique({
      where: { id: input.channelId },
      select: { id: true, type: true },
    });

    if (!channel) {
      throw new ResourceNotVisibleError("Channel", input.channelId);
    }

    if (channel.type !== "TEXT") {
      throw new NotATextChannelError(input.channelId);
    }

    if (input.replyToId !== undefined) {
      const target = await this.prisma.db.message.findUnique({
        where: { id: input.replyToId },
        select: { channelId: true },
      });

      if (!target || target.channelId !== input.channelId) {
        throw new ReplyTargetNotInChannelError(input.replyToId);
      }
    }

    return this.prisma.db.message.create({
      data: {
        id: this.ids.generate(),
        channelId: input.channelId,
        authorId: input.authorId,
        content: Buffer.from(encodeTextContent(input.text)),
        contentSchema: TEXT_CONTENT_SCHEMA,
        replyToId: input.replyToId ?? null,
      },
      include: { author: true },
    });
  }

  async sendDirect(input: SendDirectMessageInput): Promise<MessageWithAuthor> {
    const conversation = await this.directConversations.participant(
      input.conversationId,
      input.authorId,
    );
    const target = this.directConversations.otherUser(conversation, input.authorId);
    await this.contactPolicy.assertAllowed(input.authorId, target.id, "message");

    if (input.replyToId !== undefined) {
      const targetMessage = await this.prisma.db.message.findUnique({
        where: { id: input.replyToId },
        select: { directConversationId: true },
      });

      if (!targetMessage || targetMessage.directConversationId !== input.conversationId) {
        throw new ReplyTargetNotInChannelError(input.replyToId);
      }
    }

    if (input.clientNonce !== undefined) {
      const existing = await this.prisma.db.message.findFirst({
        where: {
          directConversationId: input.conversationId,
          authorId: input.authorId,
          clientNonce: input.clientNonce,
        },
        include: { author: true },
      });
      if (existing) return existing;
    }

    try {
      return await this.prisma.db.message.create({
        data: {
          id: this.ids.generate(),
          directConversationId: input.conversationId,
          authorId: input.authorId,
          content: Buffer.from(encodeTextContent(input.text)),
          contentSchema: TEXT_CONTENT_SCHEMA,
          replyToId: input.replyToId ?? null,
          clientNonce: input.clientNonce ?? null,
        },
        include: { author: true },
      });
    } catch (error: unknown) {
      if (
        input.clientNonce !== undefined &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return this.prisma.db.message.findFirstOrThrow({
          where: {
            directConversationId: input.conversationId,
            authorId: input.authorId,
            clientNonce: input.clientNonce,
          },
          include: { author: true },
        });
      }
      throw error;
    }
  }

  async edit(messageId: string, text: string): Promise<MessageWithAuthor> {
    await this.history.byId(messageId);

    const updated = await this.prisma.db.message.update({
      where: { id: messageId },
      data: {
        content: Buffer.from(encodeTextContent(text)),
        editedAt: new Date(),
      },
      include: { author: true },
    });

    // Announced here rather than by the caller: an edit is an edit whether it arrived over
    // HTTP or the socket, and a caller that forgets makes the change invisible to everyone
    // else until they reload.
    this.broadcaster.messageUpdated(this.presenter.toView(updated));

    return updated;
  }

  /**
   * Soft delete: replies point at this row, and unread counts are computed from message
   * order. Removing the row would break both.
   */
  async remove(messageId: string): Promise<void> {
    const message = await this.history.byId(messageId);

    await this.prisma.db.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), content: Buffer.from(encodeTextContent("")) },
    });

    if (message.channelId !== null) {
      this.broadcaster.messageDeleted({ channelId: message.channelId, messageId });
    } else if (message.directConversationId !== null) {
      this.broadcaster.directMessageDeleted({
        conversationId: message.directConversationId,
        messageId,
      });
    }
  }
}
