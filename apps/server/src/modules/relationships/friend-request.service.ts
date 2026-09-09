import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AcceptFriendRequestResponse, FriendRequestView } from "@voreli/shared";

import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../common/events/domain-event-bus.js";
import { normalizeUsername } from "../../common/identity/username.js";
import { ID_GENERATOR, type IdGenerator } from "../../common/services/id-generator.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import { contactPair } from "./contact-pair.js";
import { ContactPolicyService } from "./contact-policy.service.js";
import { DirectConversationService } from "./direct-conversation.service.js";
import {
  ContactNotFoundError,
  FriendRequestNotFoundError,
  RelationshipConflictError,
} from "./errors/relationship-errors.js";
import { RelationshipQueryService } from "./relationship-query.service.js";

@Injectable()
export class FriendRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: ContactPolicyService,
    private readonly conversations: DirectConversationService,
    private readonly views: RelationshipQueryService,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async create(userId: string, usernameInput: string): Promise<FriendRequestView> {
    const target = await this.target(userId, usernameInput);
    if (await this.policy.hasBlock(userId, target.id))
      throw new ContactNotFoundError(target.username);
    await this.policy.assertAllowed(userId, target.id, "friendRequest");
    const pair = contactPair(userId, target.id);
    try {
      const created = await this.prisma.runInTransaction(async () => {
        const [friendship, pending] = await Promise.all([
          this.prisma.db.friendship.findUnique({ where: { userLowId_userHighId: pair } }),
          this.prisma.db.friendRequest.findFirst({ where: { ...pair, status: "PENDING" } }),
        ]);
        if (friendship || pending)
          throw new RelationshipConflictError(
            friendship ? "Users are already friends" : "A friend request already exists",
            userId,
            target.id,
          );
        return this.prisma.db.friendRequest.create({
          data: { id: this.ids.generate(), ...pair, requesterId: userId, status: "PENDING" },
        });
      });
      await this.changed(userId, target.id);
      return this.views.request(created.id, created.createdAt, target);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new RelationshipConflictError("A friend request already exists", userId, target.id);
      }
      throw error;
    }
  }

  async accept(userId: string, requestId: string): Promise<AcceptFriendRequestResponse> {
    const result = await this.prisma.runInTransaction(async () => {
      const request = await this.pendingForRecipient(userId, requestId);
      const changed = await this.prisma.db.friendRequest.updateMany({
        where: { id: requestId, status: "PENDING" },
        data: { status: "ACCEPTED", resolvedAt: new Date() },
      });
      if (changed.count === 0) throw new FriendRequestNotFoundError(requestId);
      const pair = contactPair(userId, request.requesterId);
      const friendship = await this.prisma.db.friendship.upsert({
        where: { userLowId_userHighId: pair },
        create: { id: this.ids.generate(), ...pair },
        update: {},
      });
      const conversation = await this.conversations.findOrCreate(userId, request.requesterId);
      const target = await this.prisma.db.user.findUniqueOrThrow({
        where: { id: request.requesterId },
        include: { contactSettings: true },
      });
      return { friendship, conversation, target };
    });
    await this.changed(userId, result.target.id);
    const capabilities = await this.policy.capabilities(userId, result.target.id);
    return {
      friend: { ...this.views.friend(result.target, result.friendship.createdAt), capabilities },
      conversation: {
        id: result.conversation.id,
        participant: this.policy.toProfile(result.target, capabilities),
        createdAt: result.conversation.createdAt.toISOString(),
        unreadCount: 0,
        lastMessage: null,
      },
    };
  }

  async decline(userId: string, requestId: string): Promise<void> {
    const request = await this.pendingForRecipient(userId, requestId);
    await this.resolve(requestId, "DECLINED");
    await this.changed(userId, request.requesterId);
  }

  async cancel(userId: string, requestId: string): Promise<void> {
    const request = await this.prisma.db.friendRequest.findFirst({
      where: { id: requestId, requesterId: userId, status: "PENDING" },
    });
    if (!request) throw new FriendRequestNotFoundError(requestId);
    await this.resolve(requestId, "CANCELLED");
    await this.changed(
      userId,
      request.userLowId === userId ? request.userHighId : request.userLowId,
    );
  }

  private async target(userId: string, input: string) {
    const username = normalizeUsername(input);
    const target = await this.prisma.db.user.findUnique({
      where: { username },
      include: { contactSettings: true },
    });
    if (!target || target.id === userId) throw new ContactNotFoundError(username);
    return target;
  }

  private async pendingForRecipient(userId: string, requestId: string) {
    const request = await this.prisma.db.friendRequest.findFirst({
      where: {
        id: requestId,
        status: "PENDING",
        requesterId: { not: userId },
        OR: [{ userLowId: userId }, { userHighId: userId }],
      },
    });
    if (!request) throw new FriendRequestNotFoundError(requestId);
    return request;
  }

  private async resolve(requestId: string, status: "DECLINED" | "CANCELLED"): Promise<void> {
    await this.prisma.db.friendRequest.update({
      where: { id: requestId },
      data: { status, resolvedAt: new Date() },
    });
  }

  private changed(userId: string, targetUserId: string): Promise<void> {
    return this.events.publish("relationship.changed", { userId, targetUserId });
  }
}
