import { Injectable } from "@nestjs/common";
import type { Attachment, Upload, User, Message } from "@prisma/client";
import {
  decodeTextContent,
  type AttachmentView,
  type MessageReplyPreview,
  type ReactionSummary,
} from "@voreli/shared";
import { PrismaService } from "../../infra/database/prisma.service.js";

export interface MessageRelations {
  readonly reply: MessageReplyPreview | null;
  readonly attachments: readonly AttachmentView[];
  readonly reactions: readonly ReactionSummary[];
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function previewText(text: string): string {
  return Array.from(graphemes.segment(text))
    .slice(0, 120)
    .map((part) => part.segment)
    .join("");
}

function attachmentView(attachment: Attachment & { upload: Upload }): AttachmentView {
  const upload = attachment.upload;
  return {
    id: attachment.id,
    name: upload.originalName,
    mime: upload.detectedMime ?? "application/octet-stream",
    byteSize: upload.byteSize,
    width: upload.width,
    height: upload.height,
    thumbnailPath: upload.thumbnailKey ? `/attachments/${attachment.id}/preview` : null,
  };
}

@Injectable()
export class MessageReadModel {
  constructor(private readonly prisma: PrismaService) {}

  async load(
    messages: readonly Message[],
    userId?: string,
  ): Promise<ReadonlyMap<string, MessageRelations>> {
    const ids = messages
      .filter((message) => !message.deletedAt && message.contentSchema === "text/v1")
      .map((message) => message.id);
    const replyIds = messages.flatMap((message) => (message.replyToId ? [message.replyToId] : []));
    const [attachments, replies, counts, mine] = await Promise.all([
      this.prisma.db.attachment.findMany({
        where: { messageId: { in: ids } },
        include: { upload: true },
        orderBy: { position: "asc" },
      }),
      this.prisma.db.message.findMany({
        where: { id: { in: replyIds } },
        include: {
          author: true,
          attachments: { take: 1, orderBy: { position: "asc" }, include: { upload: true } },
        },
      }),
      this.prisma.db.messageReaction.groupBy({
        by: ["messageId", "emoji"],
        where: { messageId: { in: ids } },
        _count: { _all: true },
      }),
      userId
        ? this.prisma.db.messageReaction.findMany({ where: { messageId: { in: ids }, userId } })
        : Promise.resolve([]),
    ]);
    const byReply = new Map(replies.map((reply) => [reply.id, reply]));
    const byAttachment = new Map<string, AttachmentView[]>();
    for (const attachment of attachments) {
      const list = byAttachment.get(attachment.messageId) ?? [];
      list.push(attachmentView(attachment));
      byAttachment.set(attachment.messageId, list);
    }
    const own = new Set(mine.map((reaction) => `${reaction.messageId}:${reaction.emoji}`));
    const byReaction = new Map<string, ReactionSummary[]>();
    for (const count of counts) {
      const list = byReaction.get(count.messageId) ?? [];
      list.push({
        emoji: count.emoji,
        count: count._count._all,
        reactedByCurrentUser: own.has(`${count.messageId}:${count.emoji}`),
      });
      byReaction.set(count.messageId, list);
    }
    return new Map(
      messages.map((message) => {
        const target = message.replyToId ? byReply.get(message.replyToId) : null;
        const hidden = message.deletedAt !== null || message.contentSchema !== "text/v1";
        return [
          message.id,
          {
            reply: hidden || !target ? null : replyView(target),
            attachments: hidden ? [] : (byAttachment.get(message.id) ?? []),
            reactions: hidden ? [] : (byReaction.get(message.id) ?? []),
          },
        ];
      }),
    );
  }
}

function replyView(
  target: Message & { author: User; attachments: (Attachment & { upload: Upload })[] },
): MessageReplyPreview {
  return {
    id: target.id,
    author: {
      id: target.author.id,
      username: target.author.username,
      displayName: target.author.displayName,
      avatarUrl: target.author.avatarUrl,
    },
    deleted: target.deletedAt !== null,
    textPreview:
      target.deletedAt || target.contentSchema !== "text/v1"
        ? ""
        : previewText(
            decodeTextContent(target.content) || target.attachments[0]?.upload.originalName || "",
          ),
  };
}
