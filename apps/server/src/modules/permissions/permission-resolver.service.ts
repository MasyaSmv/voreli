import { Injectable } from "@nestjs/common";
import { computePermissions, type PermissionOverride } from "@voreli/shared";

import { PrismaService } from "../../infra/database/prisma.service.js";

export interface ResolvedMembership {
  readonly memberId: string;
  readonly serverId: string;
  readonly isOwner: boolean;
  /** Effective mask at server level, before any channel override. */
  readonly serverPermissions: bigint;
}

/**
 * Loads what the pure `computePermissions` needs and hands it over.
 *
 * The arithmetic lives in `packages/shared` so client and server agree bit for bit; this
 * class only knows how to fetch. Keeping the two apart is what makes the rules testable
 * without a database and the loading replaceable with a cache: when Redis arrives in M2,
 * a caching decorator wraps this class and neither the guard nor any controller changes.
 */
@Injectable()
export class PermissionResolver {
  constructor(private readonly prisma: PrismaService) {}

  /** Null when the user is not a member of that server at all. */
  async forServer(userId: string, serverId: string): Promise<ResolvedMembership | null> {
    const member = await this.prisma.db.member.findUnique({
      where: { serverId_userId: { serverId, userId } },
      include: {
        server: { select: { ownerId: true } },
        roles: { include: { role: { select: { permissions: true, isDefault: true } } } },
      },
    });

    if (!member) {
      return null;
    }

    const isOwner = member.server.ownerId === userId;
    const everyone = member.roles.find((link) => link.role.isDefault)?.role.permissions ?? 0n;
    const others = member.roles
      .filter((link) => !link.role.isDefault)
      .map((link) => link.role.permissions);

    return {
      memberId: member.id,
      serverId,
      isOwner,
      serverPermissions: computePermissions({
        isOwner,
        everyonePermissions: everyone,
        rolePermissions: others,
      }),
    };
  }

  /**
   * Same, but with the channel's overrides applied. Null when the user is not a member of
   * the server the channel belongs to, or the channel does not exist.
   */
  async forChannel(
    userId: string,
    channelId: string,
  ): Promise<(ResolvedMembership & { channelPermissions: bigint }) | null> {
    const channel = await this.prisma.db.channel.findUnique({
      where: { id: channelId },
      select: { id: true, serverId: true },
    });

    if (!channel) {
      return null;
    }

    const membership = await this.forServer(userId, channel.serverId);

    if (!membership) {
      return null;
    }

    const member = await this.prisma.db.member.findUnique({
      where: { id: membership.memberId },
      include: {
        roles: { select: { roleId: true } },
        server: { select: { ownerId: true } },
      },
    });

    const roleIds = member?.roles.map((link) => link.roleId) ?? [];

    const overrides = await this.prisma.db.channelOverride.findMany({
      where: {
        channelId,
        OR: [{ roleId: { in: roleIds } }, { memberId: membership.memberId }],
      },
      include: { role: { select: { isDefault: true } } },
    });

    const everyoneOverride = overrides.find((override) => override.role?.isDefault === true);
    const roleOverrides: PermissionOverride[] = overrides
      .filter((override) => override.roleId !== null && override.role?.isDefault !== true)
      .map((override) => ({ allow: override.allow, deny: override.deny }));
    const memberOverride = overrides.find((override) => override.memberId !== null);

    const everyone = await this.everyoneMaskOf(membership.serverId);
    const roleMasks = await this.roleMasksOf(roleIds);

    return {
      ...membership,
      channelPermissions: computePermissions({
        isOwner: membership.isOwner,
        everyonePermissions: everyone,
        rolePermissions: roleMasks,
        ...(everyoneOverride
          ? { everyoneOverride: { allow: everyoneOverride.allow, deny: everyoneOverride.deny } }
          : {}),
        roleOverrides,
        ...(memberOverride
          ? { memberOverride: { allow: memberOverride.allow, deny: memberOverride.deny } }
          : {}),
      }),
    };
  }

  /**
   * Effective channel masks for every channel of a server, in a fixed number of queries.
   *
   * Rendering the sidebar asks the same question once per channel; doing that through
   * `forChannel` would be a textbook N+1, so the overrides of the whole server are loaded
   * once and the arithmetic happens in memory.
   */
  async forServerChannels(userId: string, serverId: string): Promise<Map<string, bigint>> {
    const membership = await this.forServer(userId, serverId);

    return membership ? this.channelMasksFor(membership) : new Map();
  }

  /** Same, for a membership the caller already resolved — the guard always has one. */
  async channelMasksFor(membership: ResolvedMembership): Promise<Map<string, bigint>> {
    const serverId = membership.serverId;

    const member = await this.prisma.db.member.findUnique({
      where: { id: membership.memberId },
      include: { roles: { select: { roleId: true } } },
    });

    const roleIds = new Set(member?.roles.map((link) => link.roleId) ?? []);
    const everyone = await this.everyoneRoleOf(serverId);
    const roleMasks = await this.roleMasksOf([...roleIds]);

    const [channels, overrides] = await Promise.all([
      this.prisma.db.channel.findMany({ where: { serverId }, select: { id: true } }),
      this.prisma.db.channelOverride.findMany({
        where: {
          channel: { serverId },
          OR: [{ roleId: { in: [...roleIds] } }, { memberId: membership.memberId }],
        },
      }),
    ]);

    const byChannel = new Map<string, typeof overrides>();

    for (const override of overrides) {
      const bucket = byChannel.get(override.channelId) ?? [];
      bucket.push(override);
      byChannel.set(override.channelId, bucket);
    }

    const result = new Map<string, bigint>();

    for (const channel of channels) {
      const applicable = byChannel.get(channel.id) ?? [];
      const everyoneOverride = applicable.find((item) => item.roleId === everyone?.id);
      const memberOverride = applicable.find((item) => item.memberId !== null);
      const roleOverrides: PermissionOverride[] = applicable
        .filter((item) => item.roleId !== null && item.roleId !== everyone?.id)
        .map((item) => ({ allow: item.allow, deny: item.deny }));

      result.set(
        channel.id,
        computePermissions({
          isOwner: membership.isOwner,
          everyonePermissions: everyone?.permissions ?? 0n,
          rolePermissions: roleMasks,
          ...(everyoneOverride
            ? { everyoneOverride: { allow: everyoneOverride.allow, deny: everyoneOverride.deny } }
            : {}),
          roleOverrides,
          ...(memberOverride
            ? { memberOverride: { allow: memberOverride.allow, deny: memberOverride.deny } }
            : {}),
        }),
      );
    }

    return result;
  }

  private async everyoneRoleOf(
    serverId: string,
  ): Promise<{ id: string; permissions: bigint } | null> {
    return this.prisma.db.role.findFirst({
      where: { serverId, isDefault: true },
      select: { id: true, permissions: true },
    });
  }

  private async everyoneMaskOf(serverId: string): Promise<bigint> {
    const everyone = await this.prisma.db.role.findFirst({
      where: { serverId, isDefault: true },
      select: { permissions: true },
    });

    return everyone?.permissions ?? 0n;
  }

  private async roleMasksOf(roleIds: readonly string[]): Promise<bigint[]> {
    if (roleIds.length === 0) {
      return [];
    }

    const roles = await this.prisma.db.role.findMany({
      where: { id: { in: [...roleIds] }, isDefault: false },
      select: { permissions: true },
    });

    return roles.map((role) => role.permissions);
  }
}
