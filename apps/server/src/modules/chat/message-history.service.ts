import { Injectable } from "@nestjs/common";
import { MESSAGE_PAGE_SIZE } from "@voreli/shared";

import { PrismaService } from "../../infra/database/prisma.service.js";
import { MessageNotFoundError } from "./errors/chat-errors.js";
import type { MessageWithAuthor } from "./message-presenter.js";

export interface HistoryQuery {
  readonly channelId: string;
  readonly before?: string | undefined;
  readonly limit?: number | undefined;
}

export interface DirectHistoryQuery {
  readonly conversationId: string;
  readonly before?: string | undefined;
  readonly limit?: number | undefined;
}

export interface HistoryPage {
  readonly messages: readonly MessageWithAuthor[];
  readonly nextCursor: string | null;
}

@Injectable()
export class MessageHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async history(query: HistoryQuery): Promise<HistoryPage> {
    return this.page({ channelId: query.channelId }, query.before, query.limit);
  }

  async directHistory(query: DirectHistoryQuery): Promise<HistoryPage> {
    return this.page({ directConversationId: query.conversationId }, query.before, query.limit);
  }

  async byId(messageId: string): Promise<MessageWithAuthor> {
    const message = await this.prisma.db.message.findUnique({
      where: { id: messageId },
      include: { author: true },
    });

    if (!message || message.deletedAt !== null) throw new MessageNotFoundError(messageId);
    return message;
  }

  /** Cursor pagination follows the matching compound container/order index; never OFFSET. */
  private async page(
    container: { readonly channelId: string } | { readonly directConversationId: string },
    before?: string,
    requestedLimit?: number,
  ): Promise<HistoryPage> {
    const limit = Math.min(requestedLimit ?? MESSAGE_PAGE_SIZE, 100);
    const cursor =
      before === undefined
        ? null
        : await this.prisma.db.message.findFirst({
            where: { id: before, ...container },
            select: { createdAt: true, id: true },
          });
    const messages = await this.prisma.db.message.findMany({
      where: {
        ...container,
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
    return { messages: page, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
  }
}
