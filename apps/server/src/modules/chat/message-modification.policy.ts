import { Inject, Injectable } from "@nestjs/common";
import { hasPermission, Permission } from "@voreli/shared";
import {
  PERMISSION_RESOLVER,
  type PermissionResolverContract,
} from "../permissions/permission-resolver.contract.js";
import { DirectConversationService } from "../relationships/direct-conversation.service.js";
import { ResourceNotVisibleError } from "../permissions/errors/permission-errors.js";
import { NotMessageAuthorError } from "./errors/chat-errors.js";
import { MessageHistoryService } from "./message-history.service.js";

@Injectable()
export class MessageModificationPolicy {
  constructor(
    private readonly historyReader: MessageHistoryService,
    private readonly directConversations: DirectConversationService,
    @Inject(PERMISSION_RESOLVER) private readonly permissions: PermissionResolverContract,
  ) {}
  async assertMayModify(messageId: string, userId: string): Promise<void> {
    const message = await this.historyReader.byId(messageId);
    if (message.directConversationId !== null) {
      await this.directConversations.participant(message.directConversationId, userId);
      if (message.authorId !== userId) throw new NotMessageAuthorError(messageId);
      return;
    }

    if (message.channelId === null) throw new ResourceNotVisibleError("Message", messageId);
    const resolved = await this.permissions.forChannel(userId, message.channelId);

    if (!resolved || !hasPermission(resolved.channelPermissions, Permission.ViewChannel)) {
      throw new ResourceNotVisibleError("Message", messageId);
    }

    if (message.authorId === userId) {
      return;
    }

    if (!hasPermission(resolved.channelPermissions, Permission.ManageMessages)) {
      throw new NotMessageAuthorError(messageId);
    }
  }
}
