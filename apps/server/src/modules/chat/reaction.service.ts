import { Inject, Injectable } from "@nestjs/common";
import {
  hasPermission,
  Permission,
  TEXT_CONTENT_SCHEMA,
  type ReactionPayload,
  type ReactionUpdatedEvent,
} from "@voreli/shared";
import { PrismaService } from "../../infra/database/prisma.service.js";
import {
  PERMISSION_RESOLVER,
  type PermissionResolverContract,
} from "../permissions/permission-resolver.contract.js";
import {
  MissingPermissionError,
  ResourceNotVisibleError,
} from "../permissions/errors/permission-errors.js";
import { MessageNotFoundError, SystemMessageImmutableError } from "./errors/chat-errors.js";
import { InvalidReactionError, ReactionLimitError } from "./errors/rich-message-errors.js";
import { ChatBroadcaster } from "./chat-broadcaster.js";

export function normalizeEmoji(value: string): string {
  const emoji = value.normalize("NFC");
  const parts = Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(emoji),
  );
  // Digits and '#' have Emoji property but are only emoji with a keycap sequence.
  if (
    parts.length !== 1 ||
    Buffer.byteLength(emoji) > 32 ||
    !/\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3/u.test(emoji) ||
    !/^[\p{Emoji}\p{Emoji_Component}]+$/u.test(emoji)
  )
    throw new InvalidReactionError();
  return emoji;
}

@Injectable()
export class ReactionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PERMISSION_RESOLVER) private readonly permissions: PermissionResolverContract,
    private readonly broadcaster: ChatBroadcaster,
  ) {}

  async change(
    userId: string,
    payload: ReactionPayload,
    added: boolean,
  ): Promise<ReactionUpdatedEvent> {
    const emoji = normalizeEmoji(payload.emoji);
    const resolved = await this.permissions.forChannel(userId, payload.channelId);
    if (!resolved || !hasPermission(resolved.channelPermissions, Permission.ViewChannel))
      throw new ResourceNotVisibleError("Channel", payload.channelId);
    const result = await this.prisma.runInTransaction(async () => {
      await this.prisma.db
        .$queryRaw`SELECT id FROM messages WHERE id = ${payload.messageId} FOR UPDATE`;
      const message = await this.prisma.db.message.findUnique({ where: { id: payload.messageId } });
      if (!message || message.channelId !== payload.channelId || message.deletedAt)
        throw new MessageNotFoundError(payload.messageId);
      if (message.contentSchema !== TEXT_CONTENT_SCHEMA)
        throw new SystemMessageImmutableError(message.id);
      if (
        added &&
        message.authorId !== userId &&
        !hasPermission(resolved.channelPermissions, Permission.AddReactions)
      )
        throw new MissingPermissionError(Permission.AddReactions);
      const where = { messageId: message.id, userId, emoji };
      if (added) {
        const existing = await this.prisma.db.messageReaction.findUnique({
          where: { messageId_userId_emoji: where },
        });
        if (!existing) {
          if (
            (await this.prisma.db.messageReaction.count({
              where: { messageId: message.id, userId },
            })) >= 20
          )
            throw new ReactionLimitError();
          await this.prisma.db.messageReaction.create({ data: where });
        }
      } else await this.prisma.db.messageReaction.deleteMany({ where });
      const count = await this.prisma.db.messageReaction.count({
        where: { messageId: message.id, emoji },
      });
      return { ...payload, emoji, count, changedByUserId: userId, added };
    });
    this.broadcaster.reactionUpdated(result);
    return result;
  }
}
