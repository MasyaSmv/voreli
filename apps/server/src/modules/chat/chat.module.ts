import { Module } from "@nestjs/common";

import { RateLimitModule } from "../../common/rate-limit/rate-limit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { PermissionsModule } from "../permissions/permissions.module.js";
import { RealtimeModule } from "../realtime/realtime.module.js";
import { RelationshipsModule } from "../relationships/relationships.module.js";
import { ChatGateway } from "./chat.gateway.js";
import { ChannelChatHandlers } from "./channel-chat-handlers.js";
import { ChatBroadcaster } from "./chat-broadcaster.js";
import { ChatRoomAccessService } from "./chat-room-access.service.js";
import { DirectChatHandlers } from "./direct-chat-handlers.js";
import { DirectChatRoomAccessService } from "./direct-chat-room-access.service.js";
import { DirectConversationQueryService } from "./direct-conversation-query.service.js";
import { DirectMessagesController } from "./direct-messages.controller.js";
import { DirectUnreadService } from "./direct-unread.service.js";
import { MessagePresenter } from "./message-presenter.js";
import { MessageHistoryService } from "./message-history.service.js";
import { MessageService } from "./message.service.js";
import { MessagesController } from "./messages.controller.js";
import { UnreadService } from "./unread.service.js";

@Module({
  imports: [AuthModule, PermissionsModule, RelationshipsModule, RealtimeModule, RateLimitModule],
  controllers: [DirectMessagesController, MessagesController],
  providers: [
    ChatGateway,
    ChannelChatHandlers,
    ChatBroadcaster,
    ChatRoomAccessService,
    DirectChatHandlers,
    DirectChatRoomAccessService,
    DirectConversationQueryService,
    DirectUnreadService,
    MessageHistoryService,
    MessageService,
    MessagePresenter,
    UnreadService,
  ],
  exports: [ChatBroadcaster, MessagePresenter],
})
export class ChatModule {}
