import { Inject, Injectable } from "@nestjs/common";
import { encodeTextContent, TEXT_CONTENT_SCHEMA, MESSAGE_MAX_LENGTH } from "@voreli/shared";
import { ID_GENERATOR, type IdGenerator } from "../../common/services/id-generator.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import { ResourceNotVisibleError } from "../permissions/errors/permission-errors.js";
import { UploadLifecycleService } from "../uploads/upload-lifecycle.service.js";
import { InvalidMessageError, AttachmentAlreadyUsedError } from "./errors/rich-message-errors.js";
import {
  NotATextChannelError,
  ReplyTargetNotInChannelError,
  SystemMessageImmutableError,
} from "./errors/chat-errors.js";
import type { MessageWithAuthor } from "./message-presenter.js";

export interface SendMessageInput {
  readonly channelId: string;
  readonly authorId: string;
  readonly text: string;
  readonly replyToId?: string | undefined;
  readonly attachmentIds?: readonly string[] | undefined;
  readonly clientNonce?: string | undefined;
}

@Injectable()
export class MessageCompositionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadLifecycleService,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  send(input: SendMessageInput): Promise<MessageWithAuthor> {
    return this.prisma.runInTransaction(async () => {
      const attachments = input.attachmentIds ?? [];
      const text = input.text.trim();
      if (
        (!text && attachments.length === 0) ||
        text.length > MESSAGE_MAX_LENGTH ||
        attachments.length > 10 ||
        new Set(attachments).size !== attachments.length
      )
        throw new InvalidMessageError();
      const channel = await this.prisma.db.channel.findUnique({
        where: { id: input.channelId },
        select: { type: true },
      });
      if (!channel) throw new ResourceNotVisibleError("Channel", input.channelId);
      if (channel.type !== "TEXT") throw new NotATextChannelError(input.channelId);
      // Serialize retries before claiming uploads, including across independent sockets.
      if (input.clientNonce) {
        await this.prisma.db
          .$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.channelId + ":" + input.authorId + ":" + input.clientNonce}))`;
        const previous = await this.prisma.db.message.findFirst({
          where: {
            channelId: input.channelId,
            authorId: input.authorId,
            clientNonce: input.clientNonce,
          },
          include: { author: true },
        });
        if (previous) return previous;
      }
      if (input.replyToId) {
        const target = await this.prisma.db.message.findUnique({ where: { id: input.replyToId } });
        if (!target || target.channelId !== input.channelId)
          throw new ReplyTargetNotInChannelError(input.replyToId);
        if (target.contentSchema !== TEXT_CONTENT_SCHEMA)
          throw new SystemMessageImmutableError(target.id);
      }
      const message = await this.prisma.db.message.create({
        data: {
          id: this.ids.generate(),
          channelId: input.channelId,
          authorId: input.authorId,
          content: Buffer.from(encodeTextContent(text)),
          contentSchema: TEXT_CONTENT_SCHEMA,
          replyToId: input.replyToId ?? null,
          clientNonce: input.clientNonce ?? null,
        },
        include: { author: true },
      });
      // Stable lock order prevents two drafts listing the same uploads in reverse order deadlocking.
      for (const uploadId of [...attachments].sort()) {
        await this.uploads.withReady(uploadId, input.authorId, "ATTACHMENT", async () => {
          if (await this.prisma.db.attachment.findUnique({ where: { uploadId } }))
            throw new AttachmentAlreadyUsedError(uploadId);
          await this.prisma.db.attachment.create({
            data: {
              id: this.ids.generate(),
              uploadId,
              messageId: message.id,
              position: attachments.indexOf(uploadId),
            },
          });
        });
      }
      return message;
    });
  }
}
