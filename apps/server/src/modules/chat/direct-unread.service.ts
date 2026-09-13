import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../infra/database/prisma.service.js";
import { DirectConversationService } from "../relationships/direct-conversation.service.js";
import { MessageNotFoundError } from "./errors/chat-errors.js";

@Injectable()
export class DirectUnreadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: DirectConversationService,
  ) {}

  async markRead(userId: string, conversationId: string, messageId: string): Promise<void> {
    await this.conversations.participant(conversationId, userId);
    const message = await this.prisma.db.message.findUnique({
      where: { id: messageId },
      select: { directConversationId: true },
    });

    if (!message || message.directConversationId !== conversationId) {
      throw new MessageNotFoundError(messageId);
    }

    await this.prisma.db.directConversationRead.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      create: { conversationId, userId, lastReadMessageId: messageId },
      update: { lastReadMessageId: messageId },
    });
  }
}
