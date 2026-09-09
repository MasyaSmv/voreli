import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import type {
  AcceptFriendRequestResponse,
  DirectConversationView,
  FriendRequestView,
  RelationshipsView,
} from "@voreli/shared";

import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { type AuthContext, CurrentAuth } from "../auth/current-user.decorator.js";
import { DirectConversationService } from "./direct-conversation.service.js";
import { UsernameBodyDto } from "./dto/relationship.dto.js";
import { FriendRequestService } from "./friend-request.service.js";
import { RelationshipQueryService } from "./relationship-query.service.js";
import { RelationshipService } from "./relationship.service.js";

@Controller()
@UseGuards(AccessTokenGuard)
export class RelationshipsController {
  constructor(
    private readonly queries: RelationshipQueryService,
    private readonly requests: FriendRequestService,
    private readonly relationships: RelationshipService,
    private readonly conversations: DirectConversationService,
  ) {}

  @Get("relationships")
  list(@CurrentAuth() auth: AuthContext): Promise<RelationshipsView> {
    return this.queries.list(auth.user.id);
  }

  @Post("friend-requests")
  request(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: UsernameBodyDto,
  ): Promise<FriendRequestView> {
    return this.requests.create(auth.user.id, dto.username);
  }

  @Post("friend-requests/:requestId/accept")
  accept(
    @CurrentAuth() auth: AuthContext,
    @Param("requestId") requestId: string,
  ): Promise<AcceptFriendRequestResponse> {
    return this.requests.accept(auth.user.id, requestId);
  }

  @Post("friend-requests/:requestId/decline")
  @HttpCode(HttpStatus.NO_CONTENT)
  decline(@CurrentAuth() auth: AuthContext, @Param("requestId") requestId: string): Promise<void> {
    return this.requests.decline(auth.user.id, requestId);
  }

  @Delete("friend-requests/:requestId")
  @HttpCode(HttpStatus.NO_CONTENT)
  cancel(@CurrentAuth() auth: AuthContext, @Param("requestId") requestId: string): Promise<void> {
    return this.requests.cancel(auth.user.id, requestId);
  }

  @Delete("friends/:username")
  @HttpCode(HttpStatus.NO_CONTENT)
  unfriend(@CurrentAuth() auth: AuthContext, @Param("username") username: string): Promise<void> {
    return this.relationships.unfriend(auth.user.id, username);
  }

  @Post("blocks")
  @HttpCode(HttpStatus.NO_CONTENT)
  block(@CurrentAuth() auth: AuthContext, @Body() dto: UsernameBodyDto): Promise<void> {
    return this.relationships.block(auth.user.id, dto.username);
  }

  @Delete("blocks/:username")
  @HttpCode(HttpStatus.NO_CONTENT)
  unblock(@CurrentAuth() auth: AuthContext, @Param("username") username: string): Promise<void> {
    return this.relationships.unblock(auth.user.id, username);
  }

  @Post("direct-conversations")
  conversation(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: UsernameBodyDto,
  ): Promise<DirectConversationView> {
    return this.conversations.createByUsername(auth.user.id, dto.username);
  }
}
