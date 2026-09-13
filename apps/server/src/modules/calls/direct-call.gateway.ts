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
  type AcceptCallResponse,
  CALL_NAMESPACE,
  CallClientEvent,
  type CallConnectionQualityEvent,
  type CallIdPayload,
  type StartCallPayload,
  type StartCallResponse,
  type SyncCallResponse,
} from "@voreli/shared";
import type { Namespace } from "socket.io";

import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../common/events/domain-event-bus.js";
import { WsRateLimit } from "../../common/rate-limit/ws-rate-limit.decorator.js";
import { WsRateLimitInterceptor } from "../../common/rate-limit/ws-rate-limit.interceptor.js";
import {
  AuthenticatedGateway,
  type AuthenticatedSocket,
} from "../realtime/authenticated.gateway.js";
import { SocketAuthenticationService } from "../realtime/socket-authentication.service.js";
import { DirectCallBroadcaster } from "./direct-call-broadcaster.js";
import { DirectCallService } from "./direct-call.service.js";

@WebSocketGateway({ namespace: CALL_NAMESPACE })
@UseInterceptors(WsRateLimitInterceptor)
export class DirectCallGateway extends AuthenticatedGateway {
  @WebSocketServer()
  private readonly server!: Namespace;

  constructor(
    authentication: SocketAuthenticationService,
    @Inject(DOMAIN_EVENT_BUS) events: DomainEventBus,
    private readonly calls: DirectCallService,
    private readonly broadcaster: DirectCallBroadcaster,
  ) {
    super(authentication, events);
  }

  override afterInit(server: Namespace): void {
    super.afterInit(server);
    this.broadcaster.attach(server);
  }

  @SubscribeMessage(CallClientEvent.Start)
  @WsRateLimit({ limit: 5, windowMs: 10_000 })
  async start(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: StartCallPayload,
  ): Promise<Ack<StartCallResponse>> {
    return this.guarded(socket, async (identity) => ({
      ok: true,
      data: {
        call: await this.calls.start(identity.user.id, identity.sessionId, payload),
      },
    }));
  }

  @SubscribeMessage(CallClientEvent.Accept)
  async accept(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: CallIdPayload,
  ): Promise<Ack<AcceptCallResponse>> {
    return this.guarded(socket, async (identity) => ({
      ok: true,
      data: await this.calls.accept(payload.callId, identity.user.id, identity.sessionId),
    }));
  }

  @SubscribeMessage(CallClientEvent.Decline)
  async decline(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: CallIdPayload,
  ): Promise<Ack<StartCallResponse>> {
    return this.guarded(socket, async (identity) => ({
      ok: true,
      data: { call: await this.calls.decline(payload.callId, identity.user.id) },
    }));
  }

  @SubscribeMessage(CallClientEvent.Cancel)
  async cancel(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: CallIdPayload,
  ): Promise<Ack<StartCallResponse>> {
    return this.guarded(socket, async (identity) => ({
      ok: true,
      data: { call: await this.calls.cancel(payload.callId, identity.user.id) },
    }));
  }

  @SubscribeMessage(CallClientEvent.Hangup)
  async hangup(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: CallIdPayload,
  ): Promise<Ack<StartCallResponse>> {
    return this.guarded(socket, async (identity) => ({
      ok: true,
      data: { call: await this.calls.hangup(payload.callId, identity.user.id) },
    }));
  }

  @SubscribeMessage(CallClientEvent.ReportQuality)
  async reportQuality(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: CallConnectionQualityEvent,
  ): Promise<Ack<null>> {
    return this.guarded(socket, (identity) => {
      this.calls.reportQuality(identity.user.id, identity.sessionId, payload);
      return Promise.resolve({ ok: true, data: null });
    });
  }

  @SubscribeMessage(CallClientEvent.Sync)
  async sync(@ConnectedSocket() socket: AuthenticatedSocket): Promise<Ack<SyncCallResponse>> {
    return this.guarded(socket, async (identity) => ({
      ok: true,
      data: await this.calls.sync(identity.user.id, identity.sessionId),
    }));
  }
}
