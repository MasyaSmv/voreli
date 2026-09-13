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
import { SocketAuthenticationService } from "./socket-authentication.service.js";
import type { SocketIdentity } from "./socket-identity.service.js";
import { sessionRoomOf } from "./socket-session.registry.js";

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
    private readonly authentication: SocketAuthenticationService,
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

      this.authentication
        .authenticate(socket, typeof token === "string" ? token : undefined)
        .then((authenticated) => {
          if (!authenticated) {
            next(new Error("UNAUTHENTICATED"));

            return;
          }

          next();
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
      if (!(await this.authentication.refresh(socket, payload.accessToken))) {
        return {
          ok: false as const,
          errorCode: "UNAUTHENTICATED",
          message: "Token does not belong to this socket user",
        };
      }

      return { ok: true as const, data: { userId: currentIdentity.user.id } };
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
      if (!(await this.authentication.isActive(socket))) {
        this.logger.warn({
          message: "Socket session is no longer active",
          socketId: socket.id,
          userId: identity.user.id,
          sessionId: identity.sessionId,
        });
        socket.disconnect(true);

        return { ok: false, errorCode: "UNAUTHENTICATED", message: "Session is no longer active" };
      }

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
