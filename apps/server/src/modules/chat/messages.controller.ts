import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
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
import { EditMessageDto, HistoryQueryDto } from "./dto/message.dto.js";
import { MessagePresenter } from "./message-presenter.js";
import { MessageHistoryService } from "./message-history.service.js";
import { MessageService } from "./message.service.js";
import { UnreadService } from "./unread.service.js";
import { MessageModificationPolicy } from "./message-modification.policy.js";

/**
 * History and message edits over plain HTTP. Realtime delivery is the gateway's job; this
 * is what a client needs when it opens a channel or scrolls up.
 */
@Controller()
@UseGuards(AccessTokenGuard)
export class MessagesController {
  constructor(
    private readonly messages: MessageService,
    private readonly historyReader: MessageHistoryService,
    private readonly unread: UnreadService,
    private readonly presenter: MessagePresenter,
    private readonly modification: MessageModificationPolicy,
  ) {}

  @Get("channels/:channelId/messages")
  @UseGuards(PermissionGuard)
  @RequirePermission(Permission.ViewChannel)
  async history(
    @CurrentAuth() auth: AuthContext,
    @Param("channelId") channelId: string,
    @Query() query: HistoryQueryDto,
  ): Promise<MessagePage> {
    const page = await this.historyReader.history({
      channelId,
      before: query.before,
      limit: query.limit,
    });

    return {
      messages: await this.presenter.page(page.messages, auth.user.id),
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
    await this.modification.assertMayModify(messageId, auth.user.id);

    return this.presenter.enriched(
      await this.messages.edit(messageId, dto.text),
      null,
      auth.user.id,
    );
  }

  @Delete("messages/:messageId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param("messageId") messageId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    await this.modification.assertMayModify(messageId, auth.user.id);
    await this.messages.remove(messageId);
  }
}
