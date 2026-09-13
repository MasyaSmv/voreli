import { Injectable, Logger } from "@nestjs/common";
import {
  CallServerEvent,
  type DirectCallView,
  type CallAnsweredEvent,
  type CallConnectionQualityEvent,
  type CallParticipantReconnectingEvent,
} from "@voreli/shared";
import type { Namespace } from "socket.io";

import { sessionRoomOf, userRoomOf } from "../realtime/socket-session.registry.js";

@Injectable()
export class DirectCallBroadcaster {
  private readonly logger = new Logger(DirectCallBroadcaster.name);
  private server?: Namespace;

  attach(server: Namespace): void {
    this.server = server;
  }

  incoming(call: DirectCallView): void {
    this.emit(userRoomOf(call.callee.id), CallServerEvent.Incoming, { call });
  }

  ringing(call: DirectCallView): void {
    this.emit(userRoomOf(call.caller.id), CallServerEvent.Ringing, { call });
  }

  answered(
    call: DirectCallView,
    callerSessionId: string,
    answeredSessionId: string,
    mediaRoomId: string,
  ): void {
    if (!this.server) return this.missing(CallServerEvent.Answered);

    const calleeRoom = userRoomOf(call.callee.id);
    const acceptedDevice = sessionRoomOf(answeredSessionId);
    const otherDeviceEvent: CallAnsweredEvent = {
      call,
      answeredByCurrentDevice: false,
      mediaRoomId: null,
    };
    const acceptedDeviceEvent: CallAnsweredEvent = {
      call,
      answeredByCurrentDevice: true,
      mediaRoomId,
    };

    const callerRoom = userRoomOf(call.caller.id);
    const callerDevice = sessionRoomOf(callerSessionId);
    this.server
      .to(callerRoom)
      .except(callerDevice)
      .emit(CallServerEvent.Answered, otherDeviceEvent);
    this.server.to(callerDevice).emit(CallServerEvent.Answered, {
      call,
      answeredByCurrentDevice: true,
      mediaRoomId,
    } satisfies CallAnsweredEvent);
    this.server
      .to(calleeRoom)
      .except(acceptedDevice)
      .emit(CallServerEvent.Answered, otherDeviceEvent);
    this.server.to(acceptedDevice).emit(CallServerEvent.Answered, acceptedDeviceEvent);
  }

  ended(call: DirectCallView): void {
    this.emit(userRoomOf(call.caller.id), CallServerEvent.Ended, { call });
    this.emit(userRoomOf(call.callee.id), CallServerEvent.Ended, { call });
  }

  quality(userId: string, event: CallConnectionQualityEvent): void {
    this.emit(userRoomOf(userId), CallServerEvent.ConnectionQuality, event);
  }

  reconnecting(call: DirectCallView, event: CallParticipantReconnectingEvent): void {
    this.emit(userRoomOf(call.caller.id), CallServerEvent.ParticipantReconnecting, event);
    this.emit(userRoomOf(call.callee.id), CallServerEvent.ParticipantReconnecting, event);
  }

  private emit(room: string, event: string, payload: unknown): void {
    if (!this.server) return this.missing(event);
    this.server.to(room).emit(event, payload);
  }

  private missing(event: string): void {
    this.logger.error({
      message: "Call broadcast dropped: no namespace attached",
      event,
      operation: "broadcastCallEvent",
    });
  }
}
