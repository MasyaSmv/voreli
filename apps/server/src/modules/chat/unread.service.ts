import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { UnreadResponse } from "@voreli/shared";

import { PrismaService } from "../../infra/database/prisma.service.js";

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
  constructor(private readonly prisma: PrismaService) {}

  async forServer(memberId: string, serverId: string): Promise<UnreadResponse> {
    const rows = await this.prisma.db.$queryRaw<UnreadRow[]>(Prisma.sql`
      SELECT m."channelId" AS "channelId", COUNT(*) AS "count"
      FROM messages m
      JOIN channels c ON c.id = m."channelId"
      LEFT JOIN channel_reads r
        ON r."channelId" = m."channelId" AND r."memberId" = ${memberId}
      LEFT JOIN messages rm ON rm.id = r."lastReadMessageId"
      WHERE c."serverId" = ${serverId}
        AND m."deletedAt" IS NULL
        AND (rm."createdAt" IS NULL OR m."createdAt" > rm."createdAt")
      GROUP BY m."channelId"
    `);

    return {
      channels: rows.map((row) => ({ channelId: row.channelId, count: Number(row.count) })),
    };
  }

  async markRead(memberId: string, channelId: string, messageId: string): Promise<void> {
    await this.prisma.db.channelRead.upsert({
      where: { memberId_channelId: { memberId, channelId } },
      create: { memberId, channelId, lastReadMessageId: messageId },
      update: { lastReadMessageId: messageId },
    });
  }
}
