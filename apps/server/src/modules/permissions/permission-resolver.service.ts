import { Injectable } from "@nestjs/common";
import { computePermissions, type PermissionOverride } from "@voreli/shared";

import { PrismaService } from "../../infra/database/prisma.service.js";
import type {
  PermissionResolverContract,
  ResolvedChannelMembership,
  ResolvedMembership,
} from "./permission-resolver.contract.js";

interface OverrideRow {
  readonly channelId: string;
  readonly roleId: string | null;
  readonly memberId: string | null;
  readonly allow: bigint;
  readonly deny: bigint;
}

/**
 * Loads what the pure `computePermissions` needs and hands it over.
 *
 * The arithmetic lives in `packages/shared` so client and server agree bit for bit; this
 * class only knows how to fetch. Keeping the two apart is what makes the rules testable
 * without a database and the loading cacheable: `CachedPermissionResolver` wraps this one
 * behind the same contract, and neither the guard nor any controller knows.
 *
 * `forServer` deliberately returns the raw masks it already read — the everyone mask, the
 * member's role ids and their masks. Everything downstream needs exactly those, and
 * carrying them is what lets `forChannel` cost three queries instead of five.
 */
@Injectable()
export class DatabasePermissionResolver implements PermissionResolverContract {
  constructor(private readonly prisma: PrismaService) {}

  async forServer(userId: string, serverId: string): Promise<ResolvedMembership | null> {
    const member = await this.prisma.db.member.findUnique({
      where: { serverId_userId: { serverId, userId } },
      include: {
        server: { select: { ownerId: true } },
        roles: { include: { role: { select: { id: true, permissions: true, isDefault: true } } } },
      },
    });

    if (!member) {
      return null;
    }

    const isOwner = member.server.ownerId === userId;
    const everyoneLink = member.roles.find((link) => link.role.isDefault);
    const others = member.roles
      .filter((link) => !link.role.isDefault)
      .map((link) => link.role.permissions);

    // A member is created together with @everyone, so the link is normally there. When it
    // is not, the row predates that invariant: fall back to the server's default role
    // rather than silently resolve permissions as if @everyone granted nothing.
    const everyone = everyoneLink?.role ?? (await this.everyoneRoleOf(serverId));

    // The fallback role's id has to join the list too. Overrides are fetched by
    // `roleId IN roleIds`, so leaving it out would hide the channel-level @everyone
    // override from this member — turning a deny into unrestricted access.
    const linkedRoleIds = member.roles.map((link) => link.roleId);
    const roleIds =
      everyone !== null && !linkedRoleIds.includes(everyone.id)
        ? [...linkedRoleIds, everyone.id]
        : linkedRoleIds;

    return {
      memberId: member.id,
      serverId,
      isOwner,
      serverPermissions: computePermissions({
        isOwner,
        everyonePermissions: everyone?.permissions ?? 0n,
        rolePermissions: others,
      }),
      everyoneRoleId: everyone?.id ?? null,
      everyonePermissions: everyone?.permissions ?? 0n,
      roleIds,
      rolePermissions: others,
    };
  }

  async forChannel(userId: string, channelId: string): Promise<ResolvedChannelMembership | null> {
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

    const overrides = await this.prisma.db.channelOverride.findMany({
      where: {
        channelId,
        OR: [{ roleId: { in: [...membership.roleIds] } }, { memberId: membership.memberId }],
      },
    });

    return {
      ...membership,
      channelPermissions: this.maskWithOverrides(membership, overrides),
    };
  }

  async forServerChannels(userId: string, serverId: string): Promise<Map<string, bigint>> {
    const membership = await this.forServer(userId, serverId);

    return membership ? this.channelMasksFor(membership) : new Map();
  }

  /**
   * Rendering the sidebar asks the same question once per channel; doing that through
   * `forChannel` would be a textbook N+1, so the overrides of the whole server are loaded
   * once and the arithmetic happens in memory.
   */
  async channelMasksFor(membership: ResolvedMembership): Promise<Map<string, bigint>> {
    const [channels, overrides] = await Promise.all([
      this.prisma.db.channel.findMany({
        where: { serverId: membership.serverId },
        select: { id: true },
      }),
      this.prisma.db.channelOverride.findMany({
        where: {
          channel: { serverId: membership.serverId },
          OR: [{ roleId: { in: [...membership.roleIds] } }, { memberId: membership.memberId }],
        },
      }),
    ]);

    const byChannel = new Map<string, OverrideRow[]>();

    for (const override of overrides) {
      const bucket = byChannel.get(override.channelId) ?? [];
      bucket.push(override);
      byChannel.set(override.channelId, bucket);
    }

    const result = new Map<string, bigint>();

    for (const channel of channels) {
      result.set(channel.id, this.maskWithOverrides(membership, byChannel.get(channel.id) ?? []));
    }

    return result;
  }

  /** The one place channel overrides are folded onto a server-level membership. */
  private maskWithOverrides(
    membership: ResolvedMembership,
    overrides: readonly OverrideRow[],
  ): bigint {
    const everyoneOverride = overrides.find(
      (override) => override.roleId !== null && override.roleId === membership.everyoneRoleId,
    );
    const memberOverride = overrides.find((override) => override.memberId !== null);
    const roleOverrides: PermissionOverride[] = overrides
      .filter(
        (override) => override.roleId !== null && override.roleId !== membership.everyoneRoleId,
      )
      .map((override) => ({ allow: override.allow, deny: override.deny }));

    return computePermissions({
      isOwner: membership.isOwner,
      everyonePermissions: membership.everyonePermissions,
      rolePermissions: [...membership.rolePermissions],
      ...(everyoneOverride
        ? { everyoneOverride: { allow: everyoneOverride.allow, deny: everyoneOverride.deny } }
        : {}),
      roleOverrides,
      ...(memberOverride
        ? { memberOverride: { allow: memberOverride.allow, deny: memberOverride.deny } }
        : {}),
    });
  }

  private async everyoneRoleOf(
    serverId: string,
  ): Promise<{ id: string; permissions: bigint } | null> {
    return this.prisma.db.role.findFirst({
      where: { serverId, isDefault: true },
      select: { id: true, permissions: true },
    });
  }
}
