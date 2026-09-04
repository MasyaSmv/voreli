import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  hasPermission,
  type MessagePage,
  type MessageView,
  Permission,
  type UnreadResponse,
} from "@voreli/shared";

import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { type AuthContext, CurrentAuth } from "../auth/current-user.decorator.js";
import { CurrentPermissions } from "../permissions/current-permissions.decorator.js";
import { type PermissionContext, PermissionGuard } from "../permissions/permission.guard.js";
import { RequirePermission } from "../permissions/require-permission.decorator.js";
import {
  PERMISSION_RESOLVER,
  type PermissionResolverContract,
} from "../permissions/permission-resolver.contract.js";
import { EditMessageDto, HistoryQueryDto } from "./dto/message.dto.js";
import { MessagePresenter } from "./message-presenter.js";
import { MessageService } from "./message.service.js";
import { NotMessageAuthorError } from "./errors/chat-errors.js";
import { UnreadService } from "./unread.service.js";
import { ResourceNotVisibleError } from "../permissions/errors/permission-errors.js";

/**
 * History and message edits over plain HTTP. Realtime delivery is the gateway's job; this
 * is what a client needs when it opens a channel or scrolls up.
 */
@Controller()
@UseGuards(AccessTokenGuard)
export class MessagesController {
  constructor(
    private readonly messages: MessageService,
    private readonly unread: UnreadService,
    private readonly presenter: MessagePresenter,
    @Inject(PERMISSION_RESOLVER) private readonly permissions: PermissionResolverContract,
  ) {}

  @Get("channels/:channelId/messages")
  @UseGuards(PermissionGuard)
  @RequirePermission(Permission.ViewChannel)
  async history(
    @Param("channelId") channelId: string,
    @Query() query: HistoryQueryDto,
  ): Promise<MessagePage> {
    const page = await this.messages.history({
      channelId,
      before: query.before,
      limit: query.limit,
    });

    return {
      messages: page.messages.map((message) => this.presenter.toView(message)),
      nextCursor: page.nextCursor,
    };
  }

  @Get("servers/:serverId/unread")
  @UseGuards(PermissionGuard)
  async unreadCounts(
    @CurrentPermissions() permissions: PermissionContext,
  ): Promise<UnreadResponse> {
    return this.unread.forServer(permissions);
  }

  @Patch("messages/:messageId")
  async edit(
    @Param("messageId") messageId: string,
    @Body() dto: EditMessageDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<MessageView> {
    await this.assertMayModify(messageId, auth.user.id);

    return this.presenter.toView(await this.messages.edit(messageId, dto.text));
  }

  @Delete("messages/:messageId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param("messageId") messageId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    await this.assertMayModify(messageId, auth.user.id);
    await this.messages.remove(messageId);
  }

  /**
   * Messages are addressed by their own id, so the guard cannot resolve the channel from
   * the route. The check happens here instead — the one place in the codebase where a
   * permission is verified outside PermissionGuard, and it is confined to two routes.
   */
  private async assertMayModify(messageId: string, userId: string): Promise<void> {
    const message = await this.messages.byId(messageId);
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
