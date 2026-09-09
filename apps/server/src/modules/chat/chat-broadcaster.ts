import { Injectable, Logger } from "@nestjs/common";
import {
  type DirectMessageDeletedEvent,
  type MessageDeletedEvent,
  type MessageView,
  ServerEvent,
} from "@voreli/shared";
import type { Namespace } from "socket.io";

/** Socket.IO room holding everyone currently looking at a channel. */
export function channelRoomOf(channelId: string): string {
  return `channel:${channelId}`;
}

export function directRoomOf(conversationId: string): string {
  return `dm:${conversationId}`;
}

/**
 * The one way a change to a message reaches the people looking at it.
 *
 * It exists because edits arrive over two transports: the gateway and plain HTTP. Leaving
 * the emit in the gateway meant an HTTP edit was invisible until the client reloaded
 * history — the bug this class removes. Business code depends on this, never on Socket.IO.
 *
 * Emitting through the local namespace is enough on several instances: the Redis adapter
 * forwards a room broadcast to every process, which is why it was wired in before it was
 * needed.
 */
@Injectable()
export class ChatBroadcaster {
  private readonly logger = new Logger(ChatBroadcaster.name);
  private server?: Namespace;

  /** Called by the gateway once its namespace exists; nothing else may call it. */
  attach(server: Namespace): void {
    this.server = server;
  }

  messageCreated(message: MessageView): void {
    if (message.channelId !== null) {
      this.emit(channelRoomOf(message.channelId), ServerEvent.MessageNew, message);
    } else if (message.directConversationId !== null) {
      this.emit(directRoomOf(message.directConversationId), ServerEvent.DirectMessageNew, message);
    }
  }

  messageUpdated(message: MessageView): void {
    if (message.channelId !== null) {
      this.emit(channelRoomOf(message.channelId), ServerEvent.MessageUpdated, message);
    } else if (message.directConversationId !== null) {
      this.emit(
        directRoomOf(message.directConversationId),
        ServerEvent.DirectMessageUpdated,
        message,
      );
    }
  }

  messageDeleted(event: MessageDeletedEvent): void {
    this.emit(channelRoomOf(event.channelId), ServerEvent.MessageDeleted, event);
  }

  directMessageDeleted(event: DirectMessageDeletedEvent): void {
    this.emit(directRoomOf(event.conversationId), ServerEvent.DirectMessageDeleted, event);
  }

  private emit(room: string, event: string, payload: unknown): void {
    if (!this.server) {
      // Reachable only if a message is written before the gateway starts — in practice a
      // misconfigured module. Silence here would look like a delivery bug forever.
      this.logger.error({
        message: "Chat broadcast dropped: no namespace attached",
        event,
        room,
        operation: "broadcastChatEvent",
      });

      return;
    }

    this.server.to(room).emit(event, payload);
  }
}
