import { Inject, Injectable } from "@nestjs/common";
import {
  type CategoryView,
  type ChannelView,
  hasPermission,
  Permission,
  type RoleView,
  serializePermissions,
  type ServerSummary,
  type ServerView,
} from "@voreli/shared";

import { PrismaService } from "../../infra/database/prisma.service.js";
import {
  PERMISSION_RESOLVER,
  type PermissionResolverContract,
  type ResolvedMembership,
} from "../permissions/permission-resolver.contract.js";
import { ResourceNotVisibleError } from "../permissions/errors/permission-errors.js";

/**
 * Builds the picture of a server for one specific member.
 *
 * Channels the member may not view are absent rather than flagged: a list that says "there
 * are 3 more channels you cannot see" is itself a leak.
 */
@Injectable()
export class ServerViewService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PERMISSION_RESOLVER) private readonly permissions: PermissionResolverContract,
  ) {}

  async listFor(userId: string): Promise<readonly ServerSummary[]> {
    const memberships = await this.prisma.db.member.findMany({
      where: { userId },
      include: { server: true },
      orderBy: { joinedAt: "asc" },
    });

    return memberships.map((membership) => this.summarize(membership.server, userId));
  }

  /**
   * `membership` comes from the guard, which already resolved it for this request.
   * Resolving it a second time here would be the same work twice on every page load.
   */
  async viewFor(
    userId: string,
    serverId: string,
    membership: ResolvedMembership,
  ): Promise<ServerView> {

    const server = await this.prisma.db.server.findUnique({
      where: { id: serverId },
      include: {
        categories: { orderBy: { position: "asc" } },
        channels: { orderBy: { position: "asc" } },
        roles: { orderBy: { position: "asc" } },
      },
    });

    if (!server) {
      throw new ResourceNotVisibleError("Server", serverId);
    }

    // One resolve for the whole server rather than one per channel: the sidebar asks this
    // question for every channel, and per-channel resolution would be an N+1.
    const channelMasks = await this.permissions.channelMasksFor(membership);

    const visibleChannels: ChannelView[] = server.channels
      .filter((channel) =>
        hasPermission(channelMasks.get(channel.id) ?? 0n, Permission.ViewChannel),
      )
      .map((channel) => ({
        id: channel.id,
        categoryId: channel.categoryId,
        type: channel.type,
        name: channel.name,
        topic: channel.topic,
        position: channel.position,
      }));

    const categories: CategoryView[] = server.categories.map((category) => ({
      id: category.id,
      name: category.name,
      position: category.position,
    }));

    const roles: RoleView[] = server.roles.map((role) => ({
      id: role.id,
      name: role.name,
      color: role.color,
      permissions: serializePermissions(role.permissions),
      position: role.position,
      isDefault: role.isDefault,
    }));

    return {
      ...this.summarize(server, userId),
      categories,
      channels: visibleChannels,
      roles,
      permissions: serializePermissions(membership.serverPermissions),
    };
  }

  private summarize(
    server: { id: string; name: string; iconUrl: string | null; ownerId: string },
    userId: string,
  ): ServerSummary {
    return {
      id: server.id,
      name: server.name,
      iconUrl: server.iconUrl,
      isOwner: server.ownerId === userId,
    };
  }
}
