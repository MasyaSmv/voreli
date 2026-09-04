import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { DEFAULT_EVERYONE_PERMISSIONS } from "@voreli/shared";

import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../common/events/domain-event-bus.js";
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
  private readonly logger = new Logger(InviteRedemptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  /** Validates the code without consuming it. */
  async assertUsable(code: string): Promise<{ serverId: string }> {
    const { serverId } = await this.loadUsable(code);

    return { serverId };
  }

  /**
   * Consumes the invite and makes the user a member holding @everyone.
   *
   * A member without a role is not a valid domain object — permission resolution starts
   * from @everyone — so membership and role are created together or not at all.
   */
  async redeem(code: string, userId: string): Promise<{ serverId: string; memberId: string }> {
    const membership = await this.join(code, userId);

    // Announced even when the membership already existed: a "not a member" answer may have
    // been cached in between, and it has to stop being served now, not a TTL later.
    await this.events.publish("member.joined", {
      serverId: membership.serverId,
      userId,
    });

    return membership;
  }

  private async join(code: string, userId: string): Promise<{ serverId: string; memberId: string }> {
    try {
      return await this.joinOnce(code, userId);
    } catch (error: unknown) {
      // The same person submitting twice at once: both attempts see no membership, both
      // insert, and one loses on the unique key. That is not a failure — the state they
      // asked for exists — so read it back instead of surfacing a database error.
      const existing = isDuplicateMemberError(error)
        ? await this.prisma.db.member.findFirst({ where: { userId, server: { invites: { some: { code } } } } })
        : null;

      if (!existing) {
        throw error;
      }

      this.logger.warn({
        message: "Concurrent join by the same user; returning the membership that won",
        userId,
        inviteCode: code,
        operation: "redeemInvite",
      });

      return { serverId: existing.serverId, memberId: existing.id };
    }
  }

  private async joinOnce(
    code: string,
    userId: string,
  ): Promise<{ serverId: string; memberId: string }> {
    return this.prisma.runInTransaction(async () => {
      const invite = await this.loadUsable(code);
      const serverId = invite.serverId;

      const existing = await this.prisma.db.member.findUnique({
        where: { serverId_userId: { serverId, userId } },
      });

      // Rejoining costs nothing: the same person is already inside, so no use is spent.
      if (existing) {
        return { serverId, memberId: existing.id };
      }

      await this.consume(code, invite.maxUses);

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

      return { serverId, memberId };
    });
  }

  /**
   * Spends one use of the invite, or refuses.
   *
   * The limit is checked inside the `where` of the update rather than by a preceding read:
   * two simultaneous redemptions of an invite with `maxUses = 1` both pass a read-then-write
   * check, and both create a member. Here the row is claimed by the update itself, so
   * exactly one of them matches a row and the other sees count 0 — the same trick
   * `RefreshTokenService.rotate` uses to make concurrent rotations safe.
   *
   * Consuming before the member is created keeps the failure clean: nothing has been
   * written yet when the error unwinds the transaction.
   */
  private async consume(code: string, maxUses: number | null): Promise<void> {
    const consumed = await this.prisma.db.invite.updateMany({
      where: {
        code,
        OR: [{ maxUses: null }, { uses: { lt: this.prisma.client.invite.fields.maxUses } }],
      },
      data: { uses: { increment: 1 } },
    });

    if (consumed.count === 0) {
      // A limitless invite only fails to match when its row disappeared between the read
      // and this update — revoked mid-join, which is a refusal like any exhausted code.
      throw new InviteExhaustedError(code, maxUses ?? 0);
    }
  }

  /** Reads the invite and refuses the codes a caller may never use. */
  private async loadUsable(
    code: string,
  ): Promise<{ serverId: string; maxUses: number | null }> {
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

    return { serverId: invite.serverId, maxUses: invite.maxUses };
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

/** Prisma's unique constraint violation, which here can only be the member key. */
function isDuplicateMemberError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
