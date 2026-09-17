import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ContactCapabilities,
  FriendRequestView,
  FriendView,
  RelationshipsView,
} from "@voreli/shared";

import { PrismaService } from "../../infra/database/prisma.service.js";
import { ContactPolicyService } from "./contact-policy.service.js";

type ContactUser = Prisma.UserGetPayload<{ include: { contactSettings: true } }>;

@Injectable()
export class RelationshipQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: ContactPolicyService,
  ) {}

  async list(userId: string): Promise<RelationshipsView> {
    const [friendships, requests, blocks] = await Promise.all([
      this.prisma.db.friendship.findMany({
        where: { OR: [{ userLowId: userId }, { userHighId: userId }] },
        include: {
          userLow: { include: { contactSettings: true } },
          userHigh: { include: { contactSettings: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      this.prisma.db.friendRequest.findMany({
        where: { status: "PENDING", OR: [{ userLowId: userId }, { userHighId: userId }] },
        include: {
          userLow: { include: { contactSettings: true } },
          userHigh: { include: { contactSettings: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      this.prisma.db.userBlock.findMany({
        where: { blockerId: userId },
        include: { blocked: { include: { contactSettings: true } } },
        orderBy: [{ createdAt: "desc" }, { blockedId: "desc" }],
      }),
    ]);
    const friends = friendships.map((friendship) => {
      const user = friendship.userLowId === userId ? friendship.userHigh : friendship.userLow;
      return this.friend(user, friendship.createdAt);
    });
    const incoming: FriendRequestView[] = [];
    const outgoing: FriendRequestView[] = [];
    for (const request of requests) {
      const user = request.userLowId === userId ? request.userHigh : request.userLow;
      const view = this.request(request.id, request.createdAt, user);
      (request.requesterId === userId ? outgoing : incoming).push(view);
    }
    const blocked = blocks.map((block) =>
      this.policy.toProfile(block.blocked, {
        canMessage: false,
        canCall: false,
        canFriendRequest: false,
      }),
    );
    return { friends, incoming, outgoing, blocked };
  }

  friend(user: ContactUser, createdAt: Date): FriendView {
    return {
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      friendsSince: createdAt.toISOString(),
      capabilities: this.capabilities(user, true),
    };
  }

  request(id: string, createdAt: Date, user: ContactUser): FriendRequestView {
    const capabilities = this.capabilities(user, false);
    return {
      id,
      user: this.policy.toProfile(user, { ...capabilities, canFriendRequest: false }),
      createdAt: createdAt.toISOString(),
    };
  }

  private capabilities(user: ContactUser, isFriend: boolean): ContactCapabilities {
    return this.policy.fromAudiences(user.contactSettings ?? {}, isFriend);
  }
}
