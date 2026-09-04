import { Injectable } from "@nestjs/common";
import type { Namespace } from "socket.io";

import type { AuthenticatedSocket } from "../realtime/authenticated.gateway.js";
import { voiceRoomOf } from "./voice-broadcaster.js";

@Injectable()
export class VoiceSocketMembershipService {
  private server?: Namespace;

  attach(server: Namespace): void {
    this.server = server;
  }

  async move(socket: AuthenticatedSocket, channelId: string): Promise<void> {
    const target = voiceRoomOf(channelId);
    await this.leaveAllExcept(socket, target);
    await socket.join(target);
  }

  async leave(socket: AuthenticatedSocket): Promise<void> {
    await this.leaveAllExcept(socket);
  }

  async evictUser(userId: string, channelId: string): Promise<void> {
    const room = voiceRoomOf(channelId);
    const sockets = [...(this.server?.sockets.values() ?? [])].filter(
      (socket) =>
        socket.rooms.has(room) &&
        typeof socket.data === "object" &&
        socket.data !== null &&
        (socket.data as { userId?: unknown }).userId === userId,
    );
    for (const socket of sockets) await socket.leave(room);
  }

  private async leaveAllExcept(socket: AuthenticatedSocket, except?: string): Promise<void> {
    for (const room of socket.rooms) {
      if (room.startsWith("voice:") && room !== except) await socket.leave(room);
    }
  }
}
