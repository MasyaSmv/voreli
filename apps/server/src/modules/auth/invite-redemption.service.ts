import { Inject, Injectable } from "@nestjs/common";
import { DEFAULT_EVERYONE_PERMISSIONS } from "@voreli/shared";

import { CLOCK, type Clock } from "../../common/services/clock.js";
import { ID_GENERATOR, type IdGenerator } from "../../common/services/id-generator.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import {
  InviteExhaustedError,
  InviteExpiredError,
  InviteNotFoundError,
} from "./errors/invite-errors.js";

/**
 * Turns an invite code into membership of the server it points at.
 *
 * Kept separate from registration because the same act happens twice in the product: once
 * for a brand new account, and once for an existing user following a link to another
 * server. The second case is spec 003, and it will call this exact method.
 */
@Injectable()
export class InviteRedemptionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  /** Validates the code without consuming it. */
  async assertUsable(code: string): Promise<{ serverId: string }> {
    const invite = await this.prisma.db.invite.findUnique({ where: { code } });

    if (!invite) {
      throw new InviteNotFoundError(code);
    }

    if (invite.expiresAt !== null && invite.expiresAt.getTime() <= this.clock.now().getTime()) {
      throw new InviteExpiredError(code, invite.expiresAt);
    }

    if (invite.maxUses !== null && invite.uses >= invite.maxUses) {
      throw new InviteExhaustedError(code, invite.maxUses);
    }

    return { serverId: invite.serverId };
  }

  /**
   * Consumes the invite and makes the user a member holding @everyone.
   *
   * A member without a role is not a valid domain object — permission resolution starts
   * from @everyone — so membership and role are created together or not at all.
   */
  async redeem(code: string, userId: string): Promise<{ serverId: string; memberId: string }> {
    return this.prisma.runInTransaction(async () => {
      const { serverId } = await this.assertUsable(code);

      const existing = await this.prisma.db.member.findUnique({
        where: { serverId_userId: { serverId, userId } },
      });

      if (existing) {
        return { serverId, memberId: existing.id };
      }

      const everyone = await this.everyoneRoleOf(serverId);
      const memberId = this.ids.generate();

      await this.prisma.db.member.create({
        data: {
          id: memberId,
          serverId,
          userId,
          roles: { create: { roleId: everyone.id } },
        },
      });

      await this.prisma.db.invite.update({
        where: { code },
        data: { uses: { increment: 1 } },
      });

      return { serverId, memberId };
    });
  }

  private async everyoneRoleOf(serverId: string): Promise<{ id: string }> {
    const everyone = await this.prisma.db.role.findFirst({
      where: { serverId, isDefault: true },
      select: { id: true },
    });

    if (everyone) {
      return everyone;
    }

    // A server without @everyone means the row was created outside the normal path. Repair
    // it rather than refuse the join: the invariant matters more than its history.
    return this.prisma.db.role.create({
      data: {
        id: this.ids.generate(),
        serverId,
        name: "@everyone",
        isDefault: true,
        position: 0,
        permissions: DEFAULT_EVERYONE_PERMISSIONS,
      },
      select: { id: true },
    });
  }
}
