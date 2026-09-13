import { Injectable } from "@nestjs/common";

import type { AuthenticatedSocket } from "./authenticated.gateway.js";
import type { SocketIdentity } from "./socket-identity.service.js";

export function sessionRoomOf(sessionId: string): string {
  return `session:${sessionId}`;
}

export function userRoomOf(userId: string): string {
  return `user:${userId}`;
}

/** Socket.IO rooms are the distributed registry; this service owns their bookkeeping. */
@Injectable()
export class SocketSessionRegistry {
  async bind(socket: AuthenticatedSocket, identity: SocketIdentity): Promise<void> {
    socket.identity = identity;
    socket.data.userId = identity.user.id;
    socket.data.sessionId = identity.sessionId;
    await socket.join(sessionRoomOf(identity.sessionId));
    await socket.join(userRoomOf(identity.user.id));
  }

  async move(
    socket: AuthenticatedSocket,
    previous: SocketIdentity,
    current: SocketIdentity,
  ): Promise<void> {
    await socket.leave(sessionRoomOf(previous.sessionId));
    await socket.join(sessionRoomOf(current.sessionId));
    socket.identity = current;
    socket.data.userId = current.user.id;
    socket.data.sessionId = current.sessionId;
  }
}
