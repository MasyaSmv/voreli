import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ServerEvent, type DirectAccessRevokedEvent } from "@voreli/shared";
import type { Namespace } from "socket.io";

import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
  type DomainEventMap,
} from "../../common/events/domain-event-bus.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import { ContactPolicyService } from "../relationships/contact-policy.service.js";
import { directRoomOf } from "./chat-broadcaster.js";
import { userRoomOf } from "../realtime/socket-session.registry.js";

function userIdOf(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const userId = (data as Record<string, unknown>)["userId"];
  return typeof userId === "string" ? userId : null;
}

@Injectable()
export class DirectChatRoomAccessService implements OnModuleInit, OnModuleDestroy {
  private server?: Namespace;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
    private readonly prisma: PrismaService,
    private readonly policy: ContactPolicyService,
  ) {}

  attach(server: Namespace): void {
    this.server = server;
  }

  onModuleInit(): void {
    this.unsubscribers.push(
      this.events.subscribe("relationship.changed", (event) => this.recheckPair(event)),
      this.events.subscribe("contact.policy.changed", (event) => this.recheckUser(event)),
    );
  }

  onModuleDestroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
  }

  private async recheckPair(event: DomainEventMap["relationship.changed"]): Promise<void> {
    this.server?.to(userRoomOf(event.userId)).emit(ServerEvent.RelationshipChanged, {});
    this.server?.to(userRoomOf(event.targetUserId)).emit(ServerEvent.RelationshipChanged, {});
    const conversation = await this.prisma.db.directConversation.findFirst({
      where: {
        OR: [
          { userLowId: event.userId, userHighId: event.targetUserId },
          { userLowId: event.targetUserId, userHighId: event.userId },
        ],
      },
    });
    if (conversation)
      await this.recheckConversation(
        conversation.id,
        conversation.userLowId,
        conversation.userHighId,
      );
  }

  private async recheckUser(event: DomainEventMap["contact.policy.changed"]): Promise<void> {
    const conversations = await this.prisma.db.directConversation.findMany({
      where: { OR: [{ userLowId: event.userId }, { userHighId: event.userId }] },
      select: { id: true, userLowId: true, userHighId: true },
    });
    await Promise.all(
      conversations.map((conversation) =>
        this.recheckConversation(conversation.id, conversation.userLowId, conversation.userHighId),
      ),
    );
  }

  private async recheckConversation(
    conversationId: string,
    userLowId: string,
    userHighId: string,
  ): Promise<void> {
    if (!this.server) return;
    const room = directRoomOf(conversationId);
    const sockets = [...this.server.sockets.values()].filter((socket) => socket.rooms.has(room));
    await Promise.all(
      sockets.map(async (socket) => {
        const userId = userIdOf(socket.data as unknown);
        if (userId === null) return;
        const targetId = userId === userLowId ? userHighId : userLowId;
        const capabilities = await this.policy.capabilities(userId, targetId);
        if (capabilities.canMessage) return;
        await socket.leave(room);
        const revoked: DirectAccessRevokedEvent = { conversationId };
        this.server?.to(socket.id).emit(ServerEvent.DirectAccessRevoked, revoked);
      }),
    );
  }
}
