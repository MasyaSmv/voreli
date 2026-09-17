import { Inject, Injectable } from "@nestjs/common";
import {
  type Ack,
  hasPermission,
  MESSAGE_MAX_LENGTH,
  type MessageView,
  Permission,
  ServerEvent,
  type SendMessagePayload,
  type SubscribePayload,
  type TypingEvent,
  type TypingPayload,
  TYPING_TTL_MS,
  type MarkReadPayload,
} from "@voreli/shared";

import {
  PERMISSION_RESOLVER,
  type PermissionResolverContract,
} from "../permissions/permission-resolver.contract.js";
import type { AuthenticatedSocket } from "../realtime/authenticated.gateway.js";
import type { SocketIdentity } from "../realtime/socket-identity.service.js";
import { ChatBroadcaster, channelRoomOf } from "./chat-broadcaster.js";
import { MessagePresenter } from "./message-presenter.js";
import { MessageService } from "./message.service.js";
import { UnreadService } from "./unread.service.js";

@Injectable()
export class ChannelChatHandlers {
  constructor(
    @Inject(PERMISSION_RESOLVER) private readonly permissions: PermissionResolverContract,
    private readonly messages: MessageService,
    private readonly unread: UnreadService,
    private readonly presenter: MessagePresenter,
    private readonly broadcaster: ChatBroadcaster,
  ) {}

  async subscribe(
    socket: AuthenticatedSocket,
    identity: SocketIdentity,
    payload: SubscribePayload,
  ): Promise<Ack<{ channelId: string }>> {
    const resolved = await this.permissions.forChannel(identity.user.id, payload.channelId);
    if (!resolved || !hasPermission(resolved.channelPermissions, Permission.ViewChannel)) {
      return {
        ok: false,
        errorCode: "NOT_FOUND",
        message: "Channel does not exist or is not visible",
      };
    }
    await socket.join(channelRoomOf(payload.channelId));
    return { ok: true, data: { channelId: payload.channelId } };
  }

  async unsubscribe(
    socket: AuthenticatedSocket,
    payload: SubscribePayload,
  ): Promise<Ack<{ channelId: string }>> {
    await socket.leave(channelRoomOf(payload.channelId));
    return { ok: true, data: { channelId: payload.channelId } };
  }

  async send(
    identity: SocketIdentity,
    payload: SendMessagePayload,
  ): Promise<Ack<{ message: MessageView }>> {
    const text = payload.text.trim();
    if (text.length === 0 || text.length > MESSAGE_MAX_LENGTH) {
      return {
        ok: false,
        errorCode: "INVALID_MESSAGE",
        message: `Message text must be between 1 and ${String(MESSAGE_MAX_LENGTH)} characters`,
      };
    }
    const resolved = await this.permissions.forChannel(identity.user.id, payload.channelId);
    if (!resolved || !hasPermission(resolved.channelPermissions, Permission.ViewChannel)) {
      return {
        ok: false,
        errorCode: "NOT_FOUND",
        message: "Channel does not exist or is not visible",
      };
    }
    if (!hasPermission(resolved.channelPermissions, Permission.SendMessages)) {
      return {
        ok: false,
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
    this.broadcaster.messageCreated(view);
    return { ok: true, data: { message: view } };
  }

  async typing(
    socket: AuthenticatedSocket,
    identity: SocketIdentity,
    payload: TypingPayload,
  ): Promise<Ack<null>> {
    const resolved = await this.permissions.forChannel(identity.user.id, payload.channelId);
    if (!resolved || !hasPermission(resolved.channelPermissions, Permission.ViewChannel)) {
      return { ok: false, errorCode: "NOT_FOUND", message: "Channel is not visible" };
    }
    const event: TypingEvent = {
      channelId: payload.channelId,
      userId: identity.user.id,
      displayName: identity.user.displayName,
      until: new Date(Date.now() + TYPING_TTL_MS).toISOString(),
    };
    socket.to(channelRoomOf(payload.channelId)).emit(ServerEvent.Typing, event);
    return { ok: true, data: null };
  }

  async markRead(identity: SocketIdentity, payload: MarkReadPayload): Promise<Ack<null>> {
    const resolved = await this.permissions.forChannel(identity.user.id, payload.channelId);
    if (!resolved || !hasPermission(resolved.channelPermissions, Permission.ViewChannel)) {
      return { ok: false, errorCode: "NOT_FOUND", message: "Channel is not visible" };
    }
    await this.unread.markRead(resolved.memberId, payload.channelId, payload.messageId);
    return { ok: true, data: null };
  }
}
