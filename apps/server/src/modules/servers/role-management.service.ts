import { Inject, Injectable } from "@nestjs/common";
import type { Role } from "@prisma/client";
import { ALL_PERMISSIONS, hasPermission, Permission } from "@voreli/shared";

import { ID_GENERATOR, type IdGenerator } from "../../common/services/id-generator.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import {
  PermissionEscalationError,
  ResourceNotVisibleError,
} from "../permissions/errors/permission-errors.js";
import {
  CrossServerReferenceError,
  DefaultRoleImmutableError,
  InvalidOverrideTargetError,
} from "./errors/server-errors.js";

/** Placeholder name for a role created without one. */
const UNNAMED_ROLE = "Новая роль";

export interface RoleWriteInput {
  readonly name?: string | undefined;
  readonly color?: number | undefined;
  readonly permissions?: bigint | undefined;
  readonly position?: number | undefined;
}

export interface OverrideInput {
  readonly roleId?: string | undefined;
  readonly memberId?: string | undefined;
  readonly allow: bigint;
  readonly deny: bigint;
}

/**
 * Roles and channel overrides.
 *
 * The rule that shapes this class: nobody hands out what they do not hold. Without it,
 * MANAGE_ROLES is a one-step path to Administrator, and every other permission becomes
 * decorative.
 */
@Injectable()
export class RoleManagementService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async create(serverId: string, callerMask: bigint, input: RoleWriteInput): Promise<Role> {
    const permissions = input.permissions ?? 0n;
    this.assertGrantable(callerMask, permissions);

    return this.prisma.db.role.create({
      data: {
        id: this.ids.generate(),
        serverId,
        name: (input.name ?? UNNAMED_ROLE).trim(),
        color: input.color ?? 0,
        permissions,
        position: input.position ?? (await this.nextPosition(serverId)),
      },
    });
  }

  async update(roleId: string, callerMask: bigint, input: RoleWriteInput): Promise<Role> {
    const role = await this.roleOrFail(roleId);

    if (input.permissions !== undefined) {
      this.assertGrantable(callerMask, input.permissions);
      // Also guard the bits being taken away: editing a role you could not have created is
      // the same escalation seen from the other side.
      this.assertGrantable(callerMask, role.permissions & ~input.permissions);
    }

    return this.prisma.db.role.update({
      where: { id: roleId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.color === undefined ? {} : { color: input.color }),
        ...(input.permissions === undefined ? {} : { permissions: input.permissions }),
        ...(input.position === undefined ? {} : { position: input.position }),
      },
    });
  }

  async remove(roleId: string): Promise<void> {
    const role = await this.roleOrFail(roleId);

    if (role.isDefault) {
      throw new DefaultRoleImmutableError(roleId);
    }

    await this.prisma.db.role.delete({ where: { id: roleId } });
  }

  async assignTo(memberId: string, roleId: string, callerMask: bigint): Promise<void> {
    const [member, role] = await Promise.all([
      this.memberOrFail(memberId),
      this.roleOrFail(roleId),
    ]);

    if (member.serverId !== role.serverId) {
      throw new CrossServerReferenceError("Role", roleId);
    }

    this.assertGrantable(callerMask, role.permissions);

    await this.prisma.db.memberRole.upsert({
      where: { memberId_roleId: { memberId, roleId } },
      create: { memberId, roleId },
      update: {},
    });
  }

  async revokeFrom(memberId: string, roleId: string, callerMask: bigint): Promise<void> {
    const role = await this.roleOrFail(roleId);

    if (role.isDefault) {
      throw new DefaultRoleImmutableError(roleId);
    }

    this.assertGrantable(callerMask, role.permissions);

    await this.prisma.db.memberRole.deleteMany({ where: { memberId, roleId } });
  }

  async setOverride(channelId: string, callerMask: bigint, input: OverrideInput): Promise<void> {
    const roleId = input.roleId;
    const memberId = input.memberId;
    const targetsRole = typeof roleId === "string";
    const targetsMember = typeof memberId === "string";

    if (targetsRole === targetsMember) {
      throw new InvalidOverrideTargetError();
    }

    // Both directions matter: granting a permission you lack, and denying one you could not
    // grant, are the same authority you do not have.
    this.assertGrantable(callerMask, input.allow | input.deny);

    const channel = await this.prisma.db.channel.findUnique({
      where: { id: channelId },
      select: { serverId: true },
    });

    if (!channel) {
      throw new ResourceNotVisibleError("Channel", channelId);
    }

    if (targetsRole) {
      const role = await this.roleOrFail(roleId);

      if (role.serverId !== channel.serverId) {
        throw new CrossServerReferenceError("Role", role.id);
      }

      await this.prisma.db.channelOverride.upsert({
        where: { channelId_roleId: { channelId, roleId: role.id } },
        create: {
          id: this.ids.generate(),
          channelId,
          roleId: role.id,
          allow: input.allow,
          deny: input.deny,
        },
        update: { allow: input.allow, deny: input.deny },
      });

      return;
    }

    const member = await this.memberOrFail(memberId as string);

    if (member.serverId !== channel.serverId) {
      throw new CrossServerReferenceError("Member", member.id);
    }

    await this.prisma.db.channelOverride.upsert({
      where: { channelId_memberId: { channelId, memberId: member.id } },
      create: {
        id: this.ids.generate(),
        channelId,
        memberId: member.id,
        allow: input.allow,
        deny: input.deny,
      },
      update: { allow: input.allow, deny: input.deny },
    });
  }

  async clearOverride(channelId: string, targetId: string): Promise<void> {
    await this.prisma.db.channelOverride.deleteMany({
      where: { channelId, OR: [{ roleId: targetId }, { memberId: targetId }] },
    });
  }

  /**
   * The caller may only touch bits they hold themselves. Administrator, and the full mask
   * an owner resolves to, pass everything.
   */
  private assertGrantable(callerMask: bigint, requested: bigint): void {
    if (hasPermission(callerMask, Permission.Administrator) || callerMask === ALL_PERMISSIONS) {
      return;
    }

    const missing = requested & ~callerMask;

    if (missing !== 0n) {
      throw new PermissionEscalationError(missing);
    }
  }

  private async roleOrFail(roleId: string): Promise<Role> {
    const role = await this.prisma.db.role.findUnique({ where: { id: roleId } });

    if (!role) {
      throw new ResourceNotVisibleError("Role", roleId);
    }

    return role;
  }

  private async memberOrFail(memberId: string): Promise<{ id: string; serverId: string }> {
    const member = await this.prisma.db.member.findUnique({
      where: { id: memberId },
      select: { id: true, serverId: true },
    });

    if (!member) {
      throw new ResourceNotVisibleError("Member", memberId);
    }

    return member;
  }

  private async nextPosition(serverId: string): Promise<number> {
    const last = await this.prisma.db.role.findFirst({
      where: { serverId },
      orderBy: { position: "desc" },
      select: { position: true },
    });

    return (last?.position ?? 0) + 1;
  }
}
