import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { hasPermission, Permission, type UnreadResponse } from "@voreli/shared";

import { PrismaService } from "../../infra/database/prisma.service.js";
import {
  PERMISSION_RESOLVER,
  type PermissionResolverContract,
  type ResolvedMembership,
} from "../permissions/permission-resolver.contract.js";
import { MessageNotInChannelError } from "./errors/chat-errors.js";

interface UnreadRow {
  readonly channelId: string;
  readonly count: bigint;
}

/**
 * Unread counters for every channel of a server, in exactly one query.
 *
 * Written as raw SQL on purpose: the count depends on a per-channel read mark, which is a
 * correlated comparison Prisma's query builder cannot express. The alternative was a count
 * per channel — the same N+1 this project already removed from the channel list, and it
 * would grow with every channel a server has.
 */
@Injectable()
export class UnreadService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PERMISSION_RESOLVER) private readonly permissions: PermissionResolverContract,
  ) {}

  /**
   * Counted only over channels the member may view.
   *
   * Without the filter the counter is an oracle: a badge on a channel that never appears in
   * the sidebar tells the reader both that the channel exists and how busy it is.
   */
  async forServer(membership: ResolvedMembership): Promise<UnreadResponse> {
    const masks = await this.permissions.channelMasksFor(membership);
    const visibleChannelIds = [...masks.entries()]
      .filter(([, mask]) => hasPermission(mask, Permission.ViewChannel))
      .map(([channelId]) => channelId);

    if (visibleChannelIds.length === 0) {
      return { channels: [] };
    }

    const rows = await this.prisma.db.$queryRaw<UnreadRow[]>(Prisma.sql`
      SELECT m."channelId" AS "channelId", COUNT(*) AS "count"
      FROM messages m
      LEFT JOIN channel_reads r
        ON r."channelId" = m."channelId" AND r."memberId" = ${membership.memberId}
      LEFT JOIN messages rm ON rm.id = r."lastReadMessageId"
      WHERE m."channelId" IN (${Prisma.join(visibleChannelIds)})
        AND m."deletedAt" IS NULL
        AND (rm."createdAt" IS NULL OR m."createdAt" > rm."createdAt")
      GROUP BY m."channelId"
    `);

    return {
      channels: rows.map((row) => ({ channelId: row.channelId, count: Number(row.count) })),
    };
  }

  async markRead(memberId: string, channelId: string, messageId: string): Promise<void> {
    const message = await this.prisma.db.message.findUnique({
      where: { id: messageId },
      select: { channelId: true },
    });

    if (!message || message.channelId !== channelId) {
      throw new MessageNotInChannelError(messageId, channelId);
    }

    await this.prisma.db.channelRead.upsert({
      where: { memberId_channelId: { memberId, channelId } },
      create: { memberId, channelId, lastReadMessageId: messageId },
      update: { lastReadMessageId: messageId },
    });
  }
}
