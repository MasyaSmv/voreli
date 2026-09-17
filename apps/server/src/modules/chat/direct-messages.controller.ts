import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { DirectConversationView, MessagePage } from "@voreli/shared";

import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { type AuthContext, CurrentAuth } from "../auth/current-user.decorator.js";
import { DirectConversationService } from "../relationships/direct-conversation.service.js";
import { DirectConversationQueryService } from "./direct-conversation-query.service.js";
import { DirectUnreadService } from "./direct-unread.service.js";
import { HistoryQueryDto, MarkDirectReadDto } from "./dto/message.dto.js";
import { MessagePresenter } from "./message-presenter.js";
import { MessageHistoryService } from "./message-history.service.js";

@Controller("direct-conversations")
@UseGuards(AccessTokenGuard)
export class DirectMessagesController {
  constructor(
    private readonly conversations: DirectConversationService,
    private readonly queries: DirectConversationQueryService,
    private readonly messages: MessageHistoryService,
    private readonly presenter: MessagePresenter,
    private readonly unread: DirectUnreadService,
  ) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext): Promise<readonly DirectConversationView[]> {
    return this.queries.list(auth.user.id);
  }

  @Get(":conversationId/messages")
  async history(
    @CurrentAuth() auth: AuthContext,
    @Param("conversationId") conversationId: string,
    @Query() query: HistoryQueryDto,
  ): Promise<MessagePage> {
    await this.conversations.participant(conversationId, auth.user.id);
    const page = await this.messages.directHistory({
      conversationId,
      before: query.before,
      limit: query.limit,
    });

    return {
      messages: page.messages.map((message) => this.presenter.toView(message)),
      nextCursor: page.nextCursor,
    };
  }

  @Patch(":conversationId/read")
  @HttpCode(HttpStatus.NO_CONTENT)
  markRead(
    @CurrentAuth() auth: AuthContext,
    @Param("conversationId") conversationId: string,
    @Body() dto: MarkDirectReadDto,
  ): Promise<void> {
    return this.unread.markRead(auth.user.id, conversationId, dto.messageId);
  }
}
