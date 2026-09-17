import { Inject, UseInterceptors } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { type Ack, CHAT_NAMESPACE, ClientEvent, type MessageView } from "@voreli/shared";
import type { Namespace } from "socket.io";

import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../common/events/domain-event-bus.js";
import { WsRateLimit } from "../../common/rate-limit/ws-rate-limit.decorator.js";
import { WsRateLimitInterceptor } from "../../common/rate-limit/ws-rate-limit.interceptor.js";
import { validateSocketPayload } from "../../common/validation/validate-socket-payload.js";
import {
  AuthenticatedGateway,
  type AuthenticatedSocket,
} from "../realtime/authenticated.gateway.js";
import { SocketAuthenticationService } from "../realtime/socket-authentication.service.js";
import { ChannelChatHandlers } from "./channel-chat-handlers.js";
import { ChatBroadcaster } from "./chat-broadcaster.js";
import { ChatRoomAccessService } from "./chat-room-access.service.js";
import { DirectChatHandlers } from "./direct-chat-handlers.js";
import { DirectChatRoomAccessService } from "./direct-chat-room-access.service.js";
import {
  ChannelPayloadDto,
  DirectConversationDto,
  DirectMarkReadDto,
  DirectSendMessageDto,
  MarkReadDto,
  SendMessageDto,
} from "./dto/chat-socket.dto.js";

@WebSocketGateway({ namespace: CHAT_NAMESPACE })
@UseInterceptors(WsRateLimitInterceptor)
export class ChatGateway extends AuthenticatedGateway {
  @WebSocketServer()
  private readonly server!: Namespace;

  constructor(
    authentication: SocketAuthenticationService,
    @Inject(DOMAIN_EVENT_BUS) events: DomainEventBus,
    private readonly channels: ChannelChatHandlers,
    private readonly directs: DirectChatHandlers,
    private readonly channelAccess: ChatRoomAccessService,
    private readonly directAccess: DirectChatRoomAccessService,
    private readonly broadcaster: ChatBroadcaster,
  ) {
    super(authentication, events);
  }

  override afterInit(server: Namespace): void {
    super.afterInit(server);
    this.channelAccess.attach(server);
    this.directAccess.attach(server);
    this.broadcaster.attach(server);
  }

  @SubscribeMessage(ClientEvent.Subscribe)
  subscribe(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack<{ channelId: string }>> {
    return this.guarded(socket, (identity) =>
      this.channels.subscribe(socket, identity, validateSocketPayload(ChannelPayloadDto, payload)),
    );
  }

  @SubscribeMessage(ClientEvent.Unsubscribe)
  unsubscribe(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack<{ channelId: string }>> {
    return this.guarded(socket, () =>
      this.channels.unsubscribe(socket, validateSocketPayload(ChannelPayloadDto, payload)),
    );
  }

  @SubscribeMessage(ClientEvent.SendMessage)
  @WsRateLimit({ limit: 10, windowMs: 5_000 })
  sendMessage(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack<{ message: MessageView }>> {
    return this.guarded(socket, (identity) =>
      this.channels.send(identity, validateSocketPayload(SendMessageDto, payload)),
    );
  }

  @SubscribeMessage(ClientEvent.TypingStart)
  @WsRateLimit({ limit: 20, windowMs: 5_000 })
  typing(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack<null>> {
    return this.guarded(socket, (identity) =>
      this.channels.typing(socket, identity, validateSocketPayload(ChannelPayloadDto, payload)),
    );
  }

  @SubscribeMessage(ClientEvent.MarkRead)
  markRead(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack<null>> {
    return this.guarded(socket, (identity) =>
      this.channels.markRead(identity, validateSocketPayload(MarkReadDto, payload)),
    );
  }

  @SubscribeMessage(ClientEvent.DirectSubscribe)
  directSubscribe(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack<{ conversationId: string }>> {
    return this.guarded(socket, (identity) =>
      this.directs.subscribe(
        socket,
        identity,
        validateSocketPayload(DirectConversationDto, payload),
      ),
    );
  }

  @SubscribeMessage(ClientEvent.DirectUnsubscribe)
  directUnsubscribe(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack<{ conversationId: string }>> {
    return this.guarded(socket, () =>
      this.directs.unsubscribe(socket, validateSocketPayload(DirectConversationDto, payload)),
    );
  }

  @SubscribeMessage(ClientEvent.DirectSendMessage)
  @WsRateLimit({ limit: 10, windowMs: 5_000 })
  directSendMessage(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack<{ message: MessageView }>> {
    return this.guarded(socket, (identity) =>
      this.directs.send(identity, validateSocketPayload(DirectSendMessageDto, payload)),
    );
  }

  @SubscribeMessage(ClientEvent.DirectTypingStart)
  @WsRateLimit({ limit: 20, windowMs: 5_000 })
  directTyping(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack<null>> {
    return this.guarded(socket, (identity) =>
      this.directs.typing(socket, identity, validateSocketPayload(DirectConversationDto, payload)),
    );
  }

  @SubscribeMessage(ClientEvent.DirectMarkRead)
  directMarkRead(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack<null>> {
    return this.guarded(socket, (identity) =>
      this.directs.markRead(identity, validateSocketPayload(DirectMarkReadDto, payload)),
    );
  }
}
