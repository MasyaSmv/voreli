import { Injectable } from "@nestjs/common";
import type { ContactAudience as PrismaContactAudience, User } from "@prisma/client";
import { ContactAudience, type ContactCapabilities, type ContactProfile } from "@voreli/shared";

import { PrismaService } from "../../infra/database/prisma.service.js";
import { contactPair } from "./contact-pair.js";
import { ContactActionNotAllowedError } from "./errors/relationship-errors.js";

export type ContactAction = "message" | "call" | "friendRequest";

const DEFAULT_AUDIENCE = ContactAudience.Everyone;

@Injectable()
export class ContactPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async capabilities(requesterId: string, targetId: string): Promise<ContactCapabilities> {
    if (requesterId === targetId) {
      return { canMessage: false, canCall: false, canFriendRequest: false };
    }

    const pair = contactPair(requesterId, targetId);
    const [settings, friendship, block, pendingRequest] = await Promise.all([
      this.prisma.db.userContactSettings.findUnique({ where: { userId: targetId } }),
      this.prisma.db.friendship.findUnique({
        where: { userLowId_userHighId: pair },
        select: { id: true },
      }),
      this.prisma.db.userBlock.findFirst({
        where: {
          OR: [
            { blockerId: requesterId, blockedId: targetId },
            { blockerId: targetId, blockedId: requesterId },
          ],
        },
        select: { blockerId: true },
      }),
      this.prisma.db.friendRequest.findFirst({
        where: { ...pair, status: "PENDING" },
        select: { id: true },
      }),
    ]);

    if (block) {
      return { canMessage: false, canCall: false, canFriendRequest: false };
    }

    const capabilities = this.fromAudiences(settings ?? {}, friendship !== null);
    return pendingRequest ? { ...capabilities, canFriendRequest: false } : capabilities;
  }

  async hasBlock(firstUserId: string, secondUserId: string): Promise<boolean> {
    return (
      (await this.prisma.db.userBlock.findFirst({
        where: {
          OR: [
            { blockerId: firstUserId, blockedId: secondUserId },
            { blockerId: secondUserId, blockedId: firstUserId },
          ],
        },
        select: { blockerId: true },
      })) !== null
    );
  }

  fromAudiences(
    settings: {
      readonly directMessageAudience?: PrismaContactAudience;
      readonly directCallAudience?: PrismaContactAudience;
      readonly friendRequestAudience?: PrismaContactAudience;
    },
    isFriend: boolean,
  ): ContactCapabilities {
    return {
      canMessage: this.allows(settings.directMessageAudience ?? DEFAULT_AUDIENCE, isFriend),
      canCall: this.allows(settings.directCallAudience ?? DEFAULT_AUDIENCE, isFriend),
      canFriendRequest:
        !isFriend && this.allows(settings.friendRequestAudience ?? DEFAULT_AUDIENCE, false),
    };
  }

  async assertAllowed(requesterId: string, targetId: string, action: ContactAction): Promise<void> {
    const capabilities = await this.capabilities(requesterId, targetId);
    const allowed =
      action === "message"
        ? capabilities.canMessage
        : action === "call"
          ? capabilities.canCall
          : capabilities.canFriendRequest;

    if (!allowed) {
      throw new ContactActionNotAllowedError(action, targetId);
    }
  }

  toProfile(user: User, capabilities: ContactCapabilities): ContactProfile {
    return {
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      capabilities,
    };
  }

  private allows(audience: PrismaContactAudience, isFriend: boolean): boolean {
    return (
      audience === ContactAudience.Everyone || (audience === ContactAudience.Friends && isFriend)
    );
  }
}
