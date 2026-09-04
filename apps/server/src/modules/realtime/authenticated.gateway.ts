import { Logger, type OnModuleDestroy } from "@nestjs/common";
import {
  Ack as AckDecorator,
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  SubscribeMessage,
} from "@nestjs/websockets";
import { type Ack, ClientEvent, type RefreshAuthPayload } from "@voreli/shared";
import type { DefaultEventsMap, Namespace, Socket } from "socket.io";

import { type DomainEventBus, type DomainEventMap } from "../../common/events/domain-event-bus.js";
import { DomainError } from "../../common/errors/domain-error.js";
import { type SocketIdentity, SocketIdentityService } from "./socket-identity.service.js";
import { sessionRoomOf, SocketSessionRegistry } from "./socket-session.registry.js";

interface AuthenticatedSocketData {
  userId?: string;
  sessionId?: string;
}

export type AuthenticatedSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  AuthenticatedSocketData
> & { identity?: SocketIdentity };

type AckCallback<T> = (response: Ack<T>) => void;

export abstract class AuthenticatedGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(this.constructor.name);
  private unsubscribeSessionRevoked?: () => void;

  protected constructor(
    private readonly identities: SocketIdentityService,
    private readonly sessions: SocketSessionRegistry,
    private readonly events: DomainEventBus,
  ) {}

  /**
   * Middleware settles identity before the connection exists, avoiding a race between an
   * asynchronous database lookup and the client's first event.
   */
  afterInit(server: Namespace): void {
    this.unsubscribeSessionRevoked = this.events.subscribe(
      "session.revoked",
      (event: DomainEventMap["session.revoked"]) => {
        server.in(sessionRoomOf(event.sessionId)).disconnectSockets(true);
      },
    );

    server.use((socket: AuthenticatedSocket, next: (error?: Error) => void) => {
      const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;

      this.identities
        .identify(typeof token === "string" ? token : undefined)
        .then((identity) => {
          if (!identity) {
            next(new Error("UNAUTHENTICATED"));

            return;
          }

          return this.sessions.bind(socket, identity).then(() => {
            next();
          });
        })
        .catch((error: unknown) => {
          this.logger.error({
            message: "Socket authentication failed",
            error,
            socketId: socket.id,
            operation: "authenticateSocketConnection",
          });
          next(new Error("UNAUTHENTICATED"));
        });
    });
  }

  handleConnection(socket: AuthenticatedSocket): void {
    const identity = socket.identity;

    if (!identity) {
      socket.disconnect(true);

      return;
    }

    this.logger.log(`Socket ${socket.id} connected as ${identity.user.id}`);
  }

  handleDisconnect(socket: AuthenticatedSocket): void {
    this.logger.log(`Socket ${socket.id} disconnected`);
  }

  onModuleDestroy(): void {
    this.unsubscribeSessionRevoked?.();
  }

  @SubscribeMessage(ClientEvent.RefreshAuth)
  async refreshAuth(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: RefreshAuthPayload,
    @AckDecorator() acknowledge: AckCallback<{ userId: string }> | undefined,
  ): Promise<void> {
    const response = await this.guarded(socket, async (currentIdentity) => {
      const refreshedIdentity = await this.identities.identify(payload.accessToken);

      if (!refreshedIdentity || refreshedIdentity.user.id !== currentIdentity.user.id) {
        return {
          ok: false as const,
          errorCode: "UNAUTHENTICATED",
          message: "Token does not belong to this socket user",
        };
      }

      await this.sessions.move(socket, currentIdentity, refreshedIdentity);

      return { ok: true as const, data: { userId: refreshedIdentity.user.id } };
    });

    acknowledge?.(response);

    if (!response.ok && response.errorCode === "UNAUTHENTICATED") {
      socket.disconnect(true);
    }
  }

  /**
   * Every event handler passes through one shell so an absent identity and thrown domain
   * errors have the same acknowledgement shape in every realtime namespace.
   */
  protected async guarded<T>(
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
    } catch (error: unknown) {
      if (error instanceof DomainError) {
        // A refused action is the rules working, not an incident: keeping it out of `error`
        // is what lets that level stay meaningful in production.
        this.logger.warn({
          message: "Socket handler rejected by domain error",
          error,
          errorCode: error.errorCode,
          socketId: socket.id,
        });

        return { ok: false, errorCode: error.errorCode, message: error.message };
      }

      this.logger.error({
        message: "Socket handler failed",
        error,
        socketId: socket.id,
      });

      return { ok: false, errorCode: "INTERNAL_ERROR", message: "Internal server error" };
    }
  }
}
