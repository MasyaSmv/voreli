import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { PermissionsModule } from "../permissions/permissions.module.js";
import { ChatGateway } from "./chat.gateway.js";
import { MessagePresenter } from "./message-presenter.js";
import { MessageService } from "./message.service.js";
import { MessagesController } from "./messages.controller.js";
import { SocketIdentityService } from "./socket-identity.service.js";
import { UnreadService } from "./unread.service.js";

@Module({
  imports: [AuthModule, PermissionsModule],
  controllers: [MessagesController],
  providers: [
    ChatGateway,
    MessageService,
    MessagePresenter,
    SocketIdentityService,
    UnreadService,
  ],
})
export class ChatModule {}
