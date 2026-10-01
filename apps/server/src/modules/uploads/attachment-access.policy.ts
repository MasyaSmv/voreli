import { Inject, Injectable } from "@nestjs/common";
import { hasPermission, Permission } from "@voreli/shared";

import { PrismaService } from "../../infra/database/prisma.service.js";
import {
  PERMISSION_RESOLVER,
  type PermissionResolverContract,
} from "../permissions/permission-resolver.contract.js";
import { DirectConversationService } from "../relationships/direct-conversation.service.js";
import { DirectConversationNotFoundError } from "../relationships/errors/relationship-errors.js";
import { AttachmentNotFoundError } from "./errors/attachment-not-found.error.js";

export interface AccessibleAttachment {
  readonly objectKey: string;
  readonly thumbnailKey: string | null;
  readonly originalName: string;
}

@Injectable()
export class AttachmentAccessPolicy {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PERMISSION_RESOLVER) private readonly permissions: PermissionResolverContract,
    private readonly conversations: DirectConversationService,
  ) {}

  async authorize(attachmentId: string, userId: string): Promise<AccessibleAttachment> {
    const attachment = await this.prisma.db.attachment.findUnique({
      where: { id: attachmentId },
      select: {
        upload: {
          select: {
            ownerId: true,
            purpose: true,
            status: true,
            objectKey: true,
            thumbnailKey: true,
            originalName: true,
          },
        },
        message: {
          select: { authorId: true, deletedAt: true, channelId: true, directConversationId: true },
        },
      },
    });
    if (
      !attachment ||
      attachment.message.deletedAt !== null ||
      attachment.upload.status !== "READY" ||
      attachment.upload.purpose !== "ATTACHMENT" ||
      attachment.upload.ownerId !== attachment.message.authorId
    ) {
      throw new AttachmentNotFoundError(attachmentId);
    }

    const { message, upload } = attachment;
    if (message.channelId !== null) {
      const membership = await this.permissions.forChannel(userId, message.channelId);
      if (!membership || !hasPermission(membership.channelPermissions, Permission.ViewChannel)) {
        throw new AttachmentNotFoundError(attachmentId);
      }
    } else if (message.directConversationId !== null) {
      try {
        await this.conversations.participant(message.directConversationId, userId);
      } catch (error: unknown) {
        if (error instanceof DirectConversationNotFoundError) {
          throw new AttachmentNotFoundError(attachmentId);
        }
        throw error;
      }
    } else {
      throw new AttachmentNotFoundError(attachmentId);
    }

    return {
      objectKey: upload.objectKey,
      originalName: upload.originalName,
      thumbnailKey: upload.thumbnailKey,
    };
  }
}
