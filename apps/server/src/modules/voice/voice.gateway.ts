import { Inject, Logger, UseInterceptors } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import {
  type Ack,
  type ConnectTransportPayload,
  type CreateConsumerPayload,
  type CreateConsumerResponse,
  type CreateProducerPayload,
  type CreateProducerResponse,
  type CreateTransportPayload,
  type CreateTransportResponse,
  type RestartIcePayload,
  type RestartIceResponse,
  type ResumeConsumerPayload,
  type SetVoiceSelfStatePayload,
  VOICE_NAMESPACE,
  VoiceClientEvent,
  type VoiceJoinPayload,
  type VoiceJoinResponse,
} from "@voreli/shared";
import type { Namespace } from "socket.io";

import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../common/events/domain-event-bus.js";
import { WsRateLimit } from "../../common/rate-limit/ws-rate-limit.decorator.js";
import { WsRateLimitInterceptor } from "../../common/rate-limit/ws-rate-limit.interceptor.js";
import {
  AuthenticatedGateway,
  type AuthenticatedSocket,
} from "../realtime/authenticated.gateway.js";
import { SocketIdentityService } from "../realtime/socket-identity.service.js";
import { SocketSessionRegistry } from "../realtime/socket-session.registry.js";
import { VoiceBroadcaster } from "./voice-broadcaster.js";
import { VoiceRoomService } from "./voice-room.service.js";
import { VoiceSignalingService } from "./voice-signaling.service.js";
import { VoiceSocketMembershipService } from "./voice-socket-membership.service.js";
import { VOICE_STATE_REPOSITORY, type VoiceStateRepository } from "./voice-state.repository.js";

@WebSocketGateway({ namespace: VOICE_NAMESPACE })
@UseInterceptors(WsRateLimitInterceptor)
export class VoiceGateway extends AuthenticatedGateway {
  private readonly disconnectLogger = new Logger(VoiceGateway.name);

  @WebSocketServer()
  private readonly server!: Namespace;

  constructor(
    identities: SocketIdentityService,
    sessions: SocketSessionRegistry,
    @Inject(DOMAIN_EVENT_BUS) events: DomainEventBus,
    @Inject(VOICE_STATE_REPOSITORY) private readonly state: VoiceStateRepository,
    private readonly rooms: VoiceRoomService,
    private readonly signaling: VoiceSignalingService,
    private readonly broadcaster: VoiceBroadcaster,
    private readonly membership: VoiceSocketMembershipService,
  ) {
    super(identities, sessions, events);
  }

  override afterInit(server: Namespace): void {
    super.afterInit(server);
    this.broadcaster.attach(server);
    this.membership.attach(server);
  }

  override handleConnection(socket: AuthenticatedSocket): void {
    super.handleConnection(socket);
    socket.conn.on("packet", (packet: unknown) => {
      if (
        typeof packet === "object" &&
        packet !== null &&
        (packet as { type?: unknown }).type === "pong" &&
        socket.identity
      ) {
        void this.state.touch(socket.identity.user.id).catch((error: unknown) => {
          this.disconnectLogger.error({
            message: "Failed to refresh voice presence TTL",
            error,
            socketId: socket.id,
            userId: socket.identity?.user.id,
            operation: "touchVoicePresence",
          });
        });
      }
    });
  }

  override handleDisconnect(socket: AuthenticatedSocket): void {
    super.handleDisconnect(socket);
    if (socket.identity) {
      void this.rooms.disconnect(socket.identity.user.id, socket.id).catch((error: unknown) => {
        this.disconnectLogger.error({
          message: "Failed to move disconnected voice participant into grace period",
          error,
          socketId: socket.id,
          userId: socket.identity?.user.id,
          operation: "disconnectVoiceSocket",
        });
      });
    }
  }

  @SubscribeMessage(VoiceClientEvent.Join)
  @WsRateLimit({ limit: 5, windowMs: 5_000 })
  async join(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: VoiceJoinPayload,
  ): Promise<Ack<VoiceJoinResponse>> {
    return this.guarded(socket, async (identity) => {
      const response = await this.rooms.join(
        identity.user.id,
        socket.id,
        payload.channelId,
        payload.sessionId,
      );
      await this.membership.move(socket, payload.channelId);
      return { ok: true as const, data: response };
    });
  }

  @SubscribeMessage(VoiceClientEvent.Leave)
  async leave(@ConnectedSocket() socket: AuthenticatedSocket): Promise<Ack<null>> {
    return this.guarded(socket, async (identity) => {
      await this.rooms.leaveUser(identity.user.id);
      await this.membership.leave(socket);
      return { ok: true as const, data: null };
    });
  }

  @SubscribeMessage(VoiceClientEvent.CreateTransport)
  async createTransport(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: CreateTransportPayload,
  ): Promise<Ack<CreateTransportResponse>> {
    return this.guarded(socket, async (identity) => ({
      ok: true as const,
      data: await this.signaling.createTransport(identity.user.id, payload),
    }));
  }

  @SubscribeMessage(VoiceClientEvent.ConnectTransport)
  async connectTransport(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: ConnectTransportPayload,
  ): Promise<Ack<null>> {
    return this.guarded(socket, async (identity) => {
      await this.signaling.connectTransport(identity.user.id, payload);
      return { ok: true as const, data: null };
    });
  }

  @SubscribeMessage(VoiceClientEvent.RestartIce)
  async restartIce(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: RestartIcePayload,
  ): Promise<Ack<RestartIceResponse>> {
    return this.guarded(socket, async (identity) => ({
      ok: true as const,
      data: await this.signaling.restartIce(identity.user.id, payload),
    }));
  }

  @SubscribeMessage(VoiceClientEvent.CreateProducer)
  async createProducer(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: CreateProducerPayload,
  ): Promise<Ack<CreateProducerResponse>> {
    return this.guarded(socket, async (identity) => ({
      ok: true as const,
      data: await this.signaling.createProducer(identity.user.id, payload),
    }));
  }

  @SubscribeMessage(VoiceClientEvent.CreateConsumer)
  async createConsumer(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: CreateConsumerPayload,
  ): Promise<Ack<CreateConsumerResponse>> {
    return this.guarded(socket, async (identity) => ({
      ok: true as const,
      data: await this.signaling.createConsumer(identity.user.id, payload),
    }));
  }

  @SubscribeMessage(VoiceClientEvent.ResumeConsumer)
  async resumeConsumer(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: ResumeConsumerPayload,
  ): Promise<Ack<null>> {
    return this.guarded(socket, async (identity) => {
      await this.signaling.resumeConsumer(identity.user.id, payload);
      return { ok: true as const, data: null };
    });
  }

  @SubscribeMessage(VoiceClientEvent.SetSelfState)
  async setSelfState(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: SetVoiceSelfStatePayload,
  ): Promise<Ack<null>> {
    return this.guarded(socket, async (identity) => {
      await this.signaling.setSelfState(identity.user.id, payload);
      return { ok: true as const, data: null };
    });
  }
}
