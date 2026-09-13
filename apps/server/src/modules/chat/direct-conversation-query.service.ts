import { Injectable } from "@nestjs/common";
import type { ContactCapabilities, DirectConversationView } from "@voreli/shared";

import { PrismaService } from "../../infra/database/prisma.service.js";
import { contactPair } from "../relationships/contact-pair.js";
import { ContactPolicyService } from "../relationships/contact-policy.service.js";
import { MessagePresenter } from "./message-presenter.js";

interface UnreadRow {
  readonly conversationId: string;
  readonly unreadCount: bigint;
}

@Injectable()
export class DirectConversationQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: ContactPolicyService,
    private readonly presenter: MessagePresenter,
  ) {}

  async list(userId: string): Promise<readonly DirectConversationView[]> {
    const conversations = await this.prisma.db.directConversation.findMany({
      where: { OR: [{ userLowId: userId }, { userHighId: userId }] },
      include: {
        userLow: { include: { contactSettings: true } },
        userHigh: { include: { contactSettings: true } },
        messages: {
          where: { deletedAt: null },
          orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
          take: 1,
          include: { author: true },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const targetIds = conversations.map((conversation) =>
      conversation.userLowId === userId ? conversation.userHighId : conversation.userLowId,
    );
    const [friendships, blocks, unreadRows] = await Promise.all([
      this.prisma.db.friendship.findMany({
        where: {
          OR: targetIds.map((targetId) => contactPair(userId, targetId)),
        },
        select: { userLowId: true, userHighId: true },
      }),
      this.prisma.db.userBlock.findMany({
        where: {
          OR: [
            { blockerId: userId, blockedId: { in: targetIds } },
            { blockerId: { in: targetIds }, blockedId: userId },
          ],
        },
        select: { blockerId: true, blockedId: true },
      }),
      this.unread(userId),
    ]);
    const friendIds = new Set(
      friendships.map((friendship) =>
        friendship.userLowId === userId ? friendship.userHighId : friendship.userLowId,
      ),
    );
    const blockedIds = new Set(
      blocks.map((block) => (block.blockerId === userId ? block.blockedId : block.blockerId)),
    );
    const unreadByConversation = new Map(
      unreadRows.map((row) => [row.conversationId, Number(row.unreadCount)]),
    );

    return conversations.map((conversation) => {
      const target =
        conversation.userLowId === userId ? conversation.userHigh : conversation.userLow;
      const capabilities: ContactCapabilities = blockedIds.has(target.id)
        ? { canMessage: false, canCall: false, canFriendRequest: false }
        : this.policy.fromAudiences(target.contactSettings ?? {}, friendIds.has(target.id));

      return {
        id: conversation.id,
        participant: this.policy.toProfile(target, capabilities),
        createdAt: conversation.createdAt.toISOString(),
        unreadCount: unreadByConversation.get(conversation.id) ?? 0,
        lastMessage:
          conversation.messages[0] === undefined
            ? null
            : this.presenter.toView(conversation.messages[0]),
      };
    });
  }

  private unread(userId: string): Promise<UnreadRow[]> {
    return this.prisma.db.$queryRaw<UnreadRow[]>`
      SELECT dc.id AS "conversationId", COUNT(message.id)::bigint AS "unreadCount"
      FROM direct_conversations dc
      LEFT JOIN direct_conversation_reads read
        ON read."conversationId" = dc.id AND read."userId" = ${userId}
      LEFT JOIN messages marker ON marker.id = read."lastReadMessageId"
      LEFT JOIN messages message
        ON message."directConversationId" = dc.id
        AND message."deletedAt" IS NULL
        AND message."authorId" <> ${userId}
        AND (
          read."lastReadMessageId" IS NULL
          OR (message."createdAt", message.id) > (marker."createdAt", marker.id)
        )
      WHERE dc."userLowId" = ${userId} OR dc."userHighId" = ${userId}
      GROUP BY dc.id
    `;
  }
}
