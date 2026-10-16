import { Injectable, Logger } from "@nestjs/common";
import type { Namespace } from "socket.io";

import type { AuthenticatedSocket } from "../realtime/authenticated.gateway.js";
import { VoiceBroadcaster } from "./voice-broadcaster.js";
import { VoiceRoomService } from "./voice-room.service.js";
import { VoiceSocketMembershipService } from "./voice-socket-membership.service.js";

@Injectable()
export class VoiceSocketLifecycleService {
  private readonly logger = new Logger(VoiceSocketLifecycleService.name);

  constructor(
    private readonly rooms: VoiceRoomService,
    private readonly broadcaster: VoiceBroadcaster,
    private readonly membership: VoiceSocketMembershipService,
  ) {}

  attach(server: Namespace): void {
    this.broadcaster.attach(server);
    this.membership.attach(server);
  }

  connected(socket: AuthenticatedSocket): void {
    socket.conn.on("packet", (packet: unknown) => {
      if (
        typeof packet === "object" &&
        packet !== null &&
        (packet as { type?: unknown }).type === "pong" &&
        socket.identity
      ) {
        void this.rooms.touchPresence(socket.identity.user.id).catch((error: unknown) => {
          this.logger.error({
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

  disconnected(socket: AuthenticatedSocket): void {
    if (socket.identity) {
      void this.rooms.disconnect(socket.identity.user.id, socket.id).catch((error: unknown) => {
        this.logger.error({
          message: "Failed to move disconnected voice participant into grace period",
          error,
          socketId: socket.id,
          userId: socket.identity?.user.id,
          operation: "disconnectVoiceSocket",
        });
      });
    }
  }
}
