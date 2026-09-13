import { Injectable } from "@nestjs/common";
import {
  type Ack,
  type DirectConversationPayload,
  type DirectMarkReadPayload,
  type DirectSendMessagePayload,
  type DirectTypingEvent,
  MESSAGE_MAX_LENGTH,
  type MessageView,
  ServerEvent,
  TYPING_TTL_MS,
} from "@voreli/shared";

import type { AuthenticatedSocket } from "../realtime/authenticated.gateway.js";
import type { SocketIdentity } from "../realtime/socket-identity.service.js";
import { ContactPolicyService } from "../relationships/contact-policy.service.js";
import { DirectConversationService } from "../relationships/direct-conversation.service.js";
import { ChatBroadcaster, directRoomOf } from "./chat-broadcaster.js";
import { DirectUnreadService } from "./direct-unread.service.js";
import { MessagePresenter } from "./message-presenter.js";
import { MessageService } from "./message.service.js";

@Injectable()
export class DirectChatHandlers {
  constructor(
    private readonly conversations: DirectConversationService,
    private readonly policy: ContactPolicyService,
    private readonly messages: MessageService,
    private readonly unread: DirectUnreadService,
    private readonly presenter: MessagePresenter,
    private readonly broadcaster: ChatBroadcaster,
  ) {}

  async subscribe(
    socket: AuthenticatedSocket,
    identity: SocketIdentity,
    payload: DirectConversationPayload,
  ): Promise<Ack<{ conversationId: string }>> {
    const conversation = await this.conversations.participant(
      payload.conversationId,
      identity.user.id,
    );
    const target = this.conversations.otherUser(conversation, identity.user.id);
    await this.policy.assertAllowed(identity.user.id, target.id, "message");
    await socket.join(directRoomOf(payload.conversationId));
    return { ok: true, data: { conversationId: payload.conversationId } };
  }

  async unsubscribe(
    socket: AuthenticatedSocket,
    payload: DirectConversationPayload,
  ): Promise<Ack<{ conversationId: string }>> {
    await socket.leave(directRoomOf(payload.conversationId));
    return { ok: true, data: { conversationId: payload.conversationId } };
  }

  async send(
    identity: SocketIdentity,
    payload: DirectSendMessagePayload,
  ): Promise<Ack<{ message: MessageView }>> {
    const text = payload.text.trim();
    if (text.length === 0 || text.length > MESSAGE_MAX_LENGTH) {
      return {
        ok: false,
        errorCode: "INVALID_MESSAGE",
        message: `Message text must be between 1 and ${String(MESSAGE_MAX_LENGTH)} characters`,
      };
    }
    const stored = await this.messages.sendDirect({
      conversationId: payload.conversationId,
      authorId: identity.user.id,
      text,
      replyToId: payload.replyToId,
      clientNonce: payload.clientNonce,
    });
    const view = this.presenter.toView(stored, payload.clientNonce ?? null);
    this.broadcaster.messageCreated(view);
    return { ok: true, data: { message: view } };
  }

  async typing(
    socket: AuthenticatedSocket,
    identity: SocketIdentity,
    payload: DirectConversationPayload,
  ): Promise<Ack<null>> {
    const conversation = await this.conversations.participant(
      payload.conversationId,
      identity.user.id,
    );
    const target = this.conversations.otherUser(conversation, identity.user.id);
    await this.policy.assertAllowed(identity.user.id, target.id, "message");
    const event: DirectTypingEvent = {
      conversationId: payload.conversationId,
      username: identity.user.username,
      displayName: identity.user.displayName,
      until: new Date(Date.now() + TYPING_TTL_MS).toISOString(),
    };
    socket.to(directRoomOf(payload.conversationId)).emit(ServerEvent.DirectTyping, event);
    return { ok: true, data: null };
  }

  async markRead(identity: SocketIdentity, payload: DirectMarkReadPayload): Promise<Ack<null>> {
    await this.unread.markRead(identity.user.id, payload.conversationId, payload.messageId);
    return { ok: true, data: null };
  }
}
