import { Inject, Injectable } from "@nestjs/common";

import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../common/events/domain-event-bus.js";
import { normalizeUsername } from "../../common/identity/username.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import { contactPair } from "./contact-pair.js";
import { ContactNotFoundError } from "./errors/relationship-errors.js";

@Injectable()
export class RelationshipService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async unfriend(userId: string, usernameInput: string): Promise<void> {
    const target = await this.target(userId, usernameInput);
    await this.prisma.db.friendship.deleteMany({ where: contactPair(userId, target.id) });
    await this.changed(userId, target.id);
  }

  async block(userId: string, usernameInput: string): Promise<void> {
    const target = await this.target(userId, usernameInput);
    const pair = contactPair(userId, target.id);

    await this.prisma.runInTransaction(async () => {
      await this.prisma.db.userBlock.upsert({
        where: { blockerId_blockedId: { blockerId: userId, blockedId: target.id } },
        create: { blockerId: userId, blockedId: target.id },
        update: {},
      });
      await Promise.all([
        this.prisma.db.friendship.deleteMany({ where: pair }),
        this.prisma.db.friendRequest.updateMany({
          where: { ...pair, status: "PENDING" },
          data: { status: "CANCELLED", resolvedAt: new Date() },
        }),
      ]);
    });

    await this.changed(userId, target.id);
  }

  async unblock(userId: string, usernameInput: string): Promise<void> {
    const target = await this.target(userId, usernameInput);
    await this.prisma.db.userBlock.deleteMany({
      where: { blockerId: userId, blockedId: target.id },
    });
    await this.changed(userId, target.id);
  }

  private async target(userId: string, usernameInput: string) {
    const username = normalizeUsername(usernameInput);
    const target = await this.prisma.db.user.findUnique({ where: { username } });
    if (!target || target.id === userId) throw new ContactNotFoundError(username);
    return target;
  }

  private changed(userId: string, targetUserId: string): Promise<void> {
    return this.events.publish("relationship.changed", { userId, targetUserId });
  }
}
