import { Module } from "@nestjs/common";

import { RateLimitModule } from "../../common/rate-limit/rate-limit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { PermissionsModule } from "../permissions/permissions.module.js";
import { RealtimeModule } from "../realtime/realtime.module.js";
import { ChatGateway } from "./chat.gateway.js";
import { ChatBroadcaster } from "./chat-broadcaster.js";
import { ChatRoomAccessService } from "./chat-room-access.service.js";
import { MessagePresenter } from "./message-presenter.js";
import { MessageService } from "./message.service.js";
import { MessagesController } from "./messages.controller.js";
import { UnreadService } from "./unread.service.js";

@Module({
  imports: [AuthModule, PermissionsModule, RealtimeModule, RateLimitModule],
  controllers: [MessagesController],
  providers: [
    ChatGateway,
    ChatBroadcaster,
    ChatRoomAccessService,
    MessageService,
    MessagePresenter,
    UnreadService,
  ],
})
export class ChatModule {}
