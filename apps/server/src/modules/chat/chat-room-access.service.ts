import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import {
  hasPermission,
  Permission,
  ServerEvent,
  type ChannelAccessRevokedEvent,
} from "@voreli/shared";
import type { Namespace } from "socket.io";

import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
  type DomainEventMap,
} from "../../common/events/domain-event-bus.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import {
  PERMISSION_RESOLVER,
  type PermissionResolverContract,
} from "../permissions/permission-resolver.contract.js";

function roomOf(channelId: string): string {
  return `channel:${channelId}`;
}

interface RoomSocket {
  readonly id: string;
  readonly rooms: ReadonlySet<string>;
  leave(room: string): Promise<void> | void;
}

function userIdOf(data: unknown): string | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const userId = (data as Record<string, unknown>)["userId"];

  return typeof userId === "string" ? userId : null;
}

/** Keeps existing room subscriptions aligned with current channel permissions. */
@Injectable()
export class ChatRoomAccessService implements OnModuleInit, OnModuleDestroy {
  private server?: Namespace;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
    @Inject(PERMISSION_RESOLVER) private readonly permissions: PermissionResolverContract,
    private readonly prisma: PrismaService,
  ) {}

  attach(server: Namespace): void {
    this.server = server;
  }

  onModuleInit(): void {
    this.unsubscribers.push(
      this.events.subscribe("member.roles.changed", (event) => this.recheckMember(event)),
      this.events.subscribe("member.removed", (event) => this.recheckMember(event)),
      this.events.subscribe("channel.overrides.changed", (event) => this.recheckChannel(event)),
    );
  }

  onModuleDestroy(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
  }

  private async recheckMember(
    event: DomainEventMap["member.roles.changed"] | DomainEventMap["member.removed"],
  ): Promise<void> {
    if (!this.server) {
      return;
    }

    const channels = await this.prisma.db.channel.findMany({
      where: { serverId: event.serverId },
      select: { id: true },
    });
    const sockets = [...this.server.sockets.values()];

    await Promise.all(
      sockets
        .filter((socket) => userIdOf(socket.data as unknown) === event.userId)
        .flatMap((socket) =>
          channels
            .filter((channel) => socket.rooms.has(roomOf(channel.id)))
            .map((channel) => this.recheckSocket(socket, event.userId, channel.id)),
        ),
    );
  }

  private async recheckChannel(event: DomainEventMap["channel.overrides.changed"]): Promise<void> {
    if (!this.server) {
      return;
    }

    const room = roomOf(event.channelId);
    const sockets = [...this.server.sockets.values()].filter((socket) => socket.rooms.has(room));

    await Promise.all(
      sockets.map(async (socket) => {
        const userId = userIdOf(socket.data as unknown);

        if (userId !== null) {
          await this.recheckSocket(socket, userId, event.channelId);
        }
      }),
    );
  }

  private async recheckSocket(
    socket: RoomSocket,
    userId: string,
    channelId: string,
  ): Promise<void> {
    const resolved = await this.permissions.forChannel(userId, channelId);

    if (resolved && hasPermission(resolved.channelPermissions, Permission.ViewChannel)) {
      return;
    }

    await socket.leave(roomOf(channelId));

    const event: ChannelAccessRevokedEvent = { channelId };
    this.server?.to(socket.id).emit(ServerEvent.ChannelAccessRevoked, event);
  }
}
