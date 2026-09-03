import { Logger } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
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
  type RefreshAuthPayload,
  type SendMessagePayload,
  ServerEvent,
  type SubscribePayload,
  type TypingEvent,
  type TypingPayload,
  TYPING_TTL_MS,
} from "@voreli/shared";
import type { Server, Socket } from "socket.io";

import { DomainError } from "../../common/errors/domain-error.js";
import { PermissionResolver } from "../permissions/permission-resolver.service.js";
import { MessagePresenter } from "./message-presenter.js";
import { MessageService } from "./message.service.js";
import { SocketIdentityService, type SocketIdentity } from "./socket-identity.service.js";
import { UnreadService } from "./unread.service.js";

/** Socket.IO room holding everyone currently looking at a channel. */
function roomOf(channelId: string): string {
  return `channel:${channelId}`;
}

interface AuthenticatedSocket extends Socket {
  identity?: SocketIdentity;
}

@WebSocketGateway({ namespace: CHAT_NAMESPACE })
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly identities: SocketIdentityService,
    private readonly permissions: PermissionResolver,
    private readonly messages: MessageService,
    private readonly unread: UnreadService,
    private readonly presenter: MessagePresenter,
  ) {}

  /**
   * Authentication runs as connection middleware, not in handleConnection.
   *
   * handleConnection is async and the client is already "connected" while it runs: a client
   * that emits immediately after connect would be rejected for having no identity yet,
   * purely because a database lookup had not finished. Middleware settles identity before
   * the connection exists at all, so there is no window.
   */
  afterInit(server: Server): void {
    server.use((socket: AuthenticatedSocket, next: (error?: Error) => void) => {
      const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;

      this.identities
        .identify(typeof token === "string" ? token : undefined)
        .then((identity) => {
          if (!identity) {
            next(new Error("UNAUTHENTICATED"));

            return;
          }

          socket.identity = identity;
          next();
        })
        .catch((error: unknown) => {
          this.logger.error(
            "Socket authentication failed",
            error instanceof Error ? error.stack : String(error),
          );
          next(new Error("UNAUTHENTICATED"));
        });
    });
  }

  handleConnection(socket: AuthenticatedSocket): void {
    this.logger.log(`Socket ${socket.id} connected as ${socket.identity?.user.id ?? "unknown"}`);
  }

  handleDisconnect(socket: AuthenticatedSocket): void {
    this.logger.log(`Socket ${socket.id} disconnected`);
  }

  /**
   * A socket outlives the 15-minute access token it connected with. Rather than dropping
   * the connection, the client sends its refreshed token and the identity is replaced in
   * place.
   */
  @SubscribeMessage(ClientEvent.RefreshAuth)
  async refreshAuth(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: RefreshAuthPayload,
  ): Promise<Ack<{ userId: string }>> {
    const identity = await this.identities.identify(payload.accessToken);

    if (!identity) {
      socket.disconnect(true);

      return { ok: false, errorCode: "UNAUTHENTICATED", message: "Token is not usable" };
    }

    socket.identity = identity;

    return { ok: true, data: { userId: identity.user.id } };
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
      this.server.to(roomOf(payload.channelId)).emit(ServerEvent.MessageNew, view);

      return { ok: true as const, data: { message: view } };
    });
  }

  @SubscribeMessage(ClientEvent.TypingStart)
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

  /**
   * Shared shell for every handler: requires an identity and turns a thrown domain error
   * into the same acknowledgement shape a refusal uses. Without it each handler would
   * repeat the check, and one of them would eventually forget.
   */
  private async guarded<T>(
    socket: AuthenticatedSocket,
    work: (identity: SocketIdentity) => Promise<Ack<T>>,
  ): Promise<Ack<T>> {
    const identity = socket.identity;

    if (!identity) {
      socket.disconnect(true);

      return { ok: false, errorCode: "UNAUTHENTICATED", message: "Socket is not authenticated" };
    }

    try {
      return await work(identity);
    } catch (error) {
      if (error instanceof DomainError) {
        this.logger.warn(`Socket ${socket.id}: ${error.errorCode} ${error.message}`);

        return { ok: false, errorCode: error.errorCode, message: error.message };
      }

      this.logger.error(
        `Socket ${socket.id} handler failed`,
        error instanceof Error ? error.stack : String(error),
      );

      return { ok: false, errorCode: "INTERNAL_ERROR", message: "Internal server error" };
    }
  }
}
