import { Inject, Injectable } from "@nestjs/common";
import { encodeTextContent, MESSAGE_PAGE_SIZE, TEXT_CONTENT_SCHEMA } from "@voreli/shared";

import { ID_GENERATOR, type IdGenerator } from "../../common/services/id-generator.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import { ResourceNotVisibleError } from "../permissions/errors/permission-errors.js";
import {
  MessageNotFoundError,
  NotATextChannelError,
  ReplyTargetNotInChannelError,
} from "./errors/chat-errors.js";
import type { MessageWithAuthor } from "./message-presenter.js";

export interface SendMessageInput {
  readonly channelId: string;
  readonly authorId: string;
  readonly text: string;
  readonly replyToId?: string | undefined;
}

export interface HistoryQuery {
  readonly channelId: string;
  /** Id of the oldest message already shown; the page returned is older than it. */
  readonly before?: string | undefined;
  readonly limit?: number | undefined;
}

export interface HistoryPage {
  readonly messages: readonly MessageWithAuthor[];
  readonly nextCursor: string | null;
}

@Injectable()
export class MessageService {
  constructor(
    private readonly prisma: PrismaService,
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

  /**
   * One page of history, newest first, walking backwards through the
   * (channelId, createdAt DESC, id DESC) index. Never OFFSET: skipping rows costs more the
   * deeper you scroll, and a message inserted meanwhile shifts the window.
   */
  async history(query: HistoryQuery): Promise<HistoryPage> {
    const limit = Math.min(query.limit ?? MESSAGE_PAGE_SIZE, 100);

    const cursor =
      query.before === undefined
        ? null
        : await this.prisma.db.message.findUnique({
            where: { id: query.before },
            select: { createdAt: true, id: true },
          });

    const messages = await this.prisma.db.message.findMany({
      where: {
        channelId: query.channelId,
        deletedAt: null,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: { author: true },
    });

    const hasMore = messages.length > limit;
    const page = hasMore ? messages.slice(0, limit) : messages;

    return {
      messages: page,
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async byId(messageId: string): Promise<MessageWithAuthor> {
    const message = await this.prisma.db.message.findUnique({
      where: { id: messageId },
      include: { author: true },
    });

    if (!message || message.deletedAt !== null) {
      throw new MessageNotFoundError(messageId);
    }

    return message;
  }

  async edit(messageId: string, text: string): Promise<MessageWithAuthor> {
    await this.byId(messageId);

    return this.prisma.db.message.update({
      where: { id: messageId },
      data: {
        content: Buffer.from(encodeTextContent(text)),
        editedAt: new Date(),
      },
      include: { author: true },
    });
  }

  /**
   * Soft delete: replies point at this row, and unread counts are computed from message
   * order. Removing the row would break both.
   */
  async remove(messageId: string): Promise<void> {
    await this.byId(messageId);

    await this.prisma.db.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), content: Buffer.from(encodeTextContent("")) },
    });
  }
}
