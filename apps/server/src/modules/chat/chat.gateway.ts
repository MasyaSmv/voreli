import { Inject, UseInterceptors } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import {
  type Ack,
  CHAT_NAMESPACE,
  ClientEvent,
  hasPermission,
  type MarkReadPayload,
  MESSAGE_MAX_LENGTH,
  type MessageView,
  Permission,
  type SendMessagePayload,
  ServerEvent,
  type SubscribePayload,
  type TypingEvent,
  type TypingPayload,
  TYPING_TTL_MS,
} from "@voreli/shared";
import type { Namespace } from "socket.io";

import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../common/events/domain-event-bus.js";
import { WsRateLimit } from "../../common/rate-limit/ws-rate-limit.decorator.js";
import { WsRateLimitInterceptor } from "../../common/rate-limit/ws-rate-limit.interceptor.js";
import {
  PERMISSION_RESOLVER,
  type PermissionResolverContract,
} from "../permissions/permission-resolver.contract.js";
import {
  AuthenticatedGateway,
  type AuthenticatedSocket,
} from "../realtime/authenticated.gateway.js";
import { SocketIdentityService } from "../realtime/socket-identity.service.js";
import { SocketSessionRegistry } from "../realtime/socket-session.registry.js";
import { ChatBroadcaster, channelRoomOf as roomOf } from "./chat-broadcaster.js";
import { ChatRoomAccessService } from "./chat-room-access.service.js";
import { MessagePresenter } from "./message-presenter.js";
import { MessageService } from "./message.service.js";
import { UnreadService } from "./unread.service.js";

@WebSocketGateway({ namespace: CHAT_NAMESPACE })
@UseInterceptors(WsRateLimitInterceptor)
export class ChatGateway extends AuthenticatedGateway {
  @WebSocketServer()
  private readonly server!: Namespace;

  constructor(
    identities: SocketIdentityService,
    sessions: SocketSessionRegistry,
    @Inject(DOMAIN_EVENT_BUS) events: DomainEventBus,
    @Inject(PERMISSION_RESOLVER) private readonly permissions: PermissionResolverContract,
    private readonly messages: MessageService,
    private readonly unread: UnreadService,
    private readonly presenter: MessagePresenter,
    private readonly roomAccess: ChatRoomAccessService,
    private readonly broadcaster: ChatBroadcaster,
  ) {
    super(identities, sessions, events);
  }

  override afterInit(server: Namespace): void {
    super.afterInit(server);
    this.roomAccess.attach(server);
    this.broadcaster.attach(server);
  }

  @SubscribeMessage(ClientEvent.Subscribe)
  async subscribe(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: SubscribePayload,
  ): Promise<Ack<{ channelId: string }>> {
    return this.guarded(socket, async (identity) => {
      const resolved = await this.permissions.forChannel(identity.user.id, payload.channelId);

      if (!resolved || !hasPermission(resolved.channelPermissions, Permission.ViewChannel)) {
        // Same reasoning as HTTP: not visible reads as not existing.
        return {
          ok: false as const,
          errorCode: "NOT_FOUND",
          message: "Channel does not exist or is not visible",
        };
      }

      await socket.join(roomOf(payload.channelId));

      return { ok: true as const, data: { channelId: payload.channelId } };
    });
  }

  @SubscribeMessage(ClientEvent.Unsubscribe)
  async unsubscribe(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: SubscribePayload,
  ): Promise<Ack<{ channelId: string }>> {
    await socket.leave(roomOf(payload.channelId));

    return { ok: true, data: { channelId: payload.channelId } };
  }

  @SubscribeMessage(ClientEvent.SendMessage)
  @WsRateLimit({ limit: 10, windowMs: 5_000 })
  async sendMessage(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: SendMessagePayload,
  ): Promise<Ack<{ message: MessageView }>> {
    return this.guarded(socket, async (identity) => {
      const text = payload.text.trim();

      if (text.length === 0 || text.length > MESSAGE_MAX_LENGTH) {
        return {
          ok: false as const,
          errorCode: "INVALID_MESSAGE",
          message: `Message text must be between 1 and ${String(MESSAGE_MAX_LENGTH)} characters`,
        };
      }

      const resolved = await this.permissions.forChannel(identity.user.id, payload.channelId);

      if (!resolved || !hasPermission(resolved.channelPermissions, Permission.ViewChannel)) {
        return {
          ok: false as const,
          errorCode: "NOT_FOUND",
          message: "Channel does not exist or is not visible",
        };
      }

      if (!hasPermission(resolved.channelPermissions, Permission.SendMessages)) {
        return {
          ok: false as const,
          errorCode: "MISSING_PERMISSION",
          message: "Sending messages is not allowed in this channel",
        };
      }

      const stored = await this.messages.send({
        channelId: payload.channelId,
        authorId: identity.user.id,
        text,
        replyToId: payload.replyToId,
      });

      const view = this.presenter.toView(stored, payload.clientNonce ?? null);

      // Everyone in the room gets it, sender included: the sender's optimistic copy is
      // replaced by matching clientNonce, so one code path serves both cases.
      this.broadcaster.messageCreated(view);

      return { ok: true as const, data: { message: view } };
    });
  }

  // Typing fires on keystrokes, so its allowance is looser than sending but still finite.
  @SubscribeMessage(ClientEvent.TypingStart)
  @WsRateLimit({ limit: 20, windowMs: 5_000 })
  async typing(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: TypingPayload,
  ): Promise<Ack<null>> {
    return this.guarded(socket, async (identity) => {
      const resolved = await this.permissions.forChannel(identity.user.id, payload.channelId);

      if (!resolved || !hasPermission(resolved.channelPermissions, Permission.ViewChannel)) {
        return { ok: false as const, errorCode: "NOT_FOUND", message: "Channel is not visible" };
      }

      const event: TypingEvent = {
        channelId: payload.channelId,
        userId: identity.user.id,
        displayName: identity.user.displayName,
        until: new Date(Date.now() + TYPING_TTL_MS).toISOString(),
      };

      // Not echoed to the sender: nobody needs to be told they are typing.
      socket.to(roomOf(payload.channelId)).emit(ServerEvent.Typing, event);

      return { ok: true as const, data: null };
    });
  }

  @SubscribeMessage(ClientEvent.MarkRead)
  async markRead(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: MarkReadPayload,
  ): Promise<Ack<null>> {
    return this.guarded(socket, async (identity) => {
      const resolved = await this.permissions.forChannel(identity.user.id, payload.channelId);

      if (!resolved || !hasPermission(resolved.channelPermissions, Permission.ViewChannel)) {
        return { ok: false as const, errorCode: "NOT_FOUND", message: "Channel is not visible" };
      }

      await this.unread.markRead(resolved.memberId, payload.channelId, payload.messageId);

      return { ok: true as const, data: null };
    });
  }
}
