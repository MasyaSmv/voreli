import { Inject, Injectable } from "@nestjs/common";
import type { DirectConversation, User } from "@prisma/client";
import type { DirectConversationView } from "@voreli/shared";

import { ID_GENERATOR, type IdGenerator } from "../../common/services/id-generator.js";
import { normalizeUsername } from "../../common/identity/username.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import { contactPair } from "./contact-pair.js";
import { ContactPolicyService } from "./contact-policy.service.js";
import {
  ContactActionNotAllowedError,
  ContactNotFoundError,
  DirectConversationNotFoundError,
} from "./errors/relationship-errors.js";

export type DirectConversationWithUsers = DirectConversation & {
  readonly userLow: User;
  readonly userHigh: User;
};

@Injectable()
export class DirectConversationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: ContactPolicyService,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async createByUsername(userId: string, usernameInput: string): Promise<DirectConversationView> {
    const username = normalizeUsername(usernameInput);
    const target = await this.prisma.db.user.findUnique({ where: { username } });

    if (!target || target.id === userId || (await this.policy.hasBlock(userId, target.id))) {
      throw new ContactNotFoundError(username);
    }

    const capabilities = await this.policy.capabilities(userId, target.id);
    if (!capabilities.canMessage && !capabilities.canCall) {
      throw new ContactActionNotAllowedError("message", target.id);
    }

    const conversation = await this.findOrCreate(userId, target.id);

    return {
      id: conversation.id,
      participant: this.policy.toProfile(target, capabilities),
      createdAt: conversation.createdAt.toISOString(),
      unreadCount: 0,
      lastMessage: null,
    };
  }

  async findOrCreate(firstUserId: string, secondUserId: string): Promise<DirectConversation> {
    const pair = contactPair(firstUserId, secondUserId);

    return this.prisma.db.directConversation.upsert({
      where: { userLowId_userHighId: pair },
      create: { id: this.ids.generate(), ...pair },
      update: {},
    });
  }

  async participant(conversationId: string, userId: string): Promise<DirectConversationWithUsers> {
    const conversation = await this.prisma.db.directConversation.findFirst({
      where: {
        id: conversationId,
        OR: [{ userLowId: userId }, { userHighId: userId }],
      },
      include: { userLow: true, userHigh: true },
    });

    if (!conversation) {
      throw new DirectConversationNotFoundError(conversationId);
    }

    return conversation;
  }

  otherUser(conversation: DirectConversationWithUsers, userId: string): User {
    return conversation.userLowId === userId ? conversation.userHigh : conversation.userLow;
  }
}
