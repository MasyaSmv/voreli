import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../infra/database/prisma.service.js";
import { ResourceNotVisibleError } from "./errors/permission-errors.js";

export interface LocatedResource {
  readonly serverId: string;
  /** Set when the request addresses a channel, so channel overrides apply. */
  readonly channelId?: string;
}

/**
 * Answers "which server does this request concern" from the route parameters.
 *
 * Routes address a category, a role or a member by id alone — the server is implied. Rather
 * than every controller looking it up (and one of them eventually forgetting), the lookup
 * lives here and the guard uses it. A new route joins the scheme by naming its parameter.
 */
@Injectable()
export class ResourceLocator {
  constructor(private readonly prisma: PrismaService) {}

  async locate(params: Record<string, string | undefined>): Promise<LocatedResource> {
    const channelId = params["channelId"];

    if (channelId !== undefined) {
      const channel = await this.prisma.db.channel.findUnique({
        where: { id: channelId },
        select: { serverId: true },
      });

      if (!channel) {
        throw new ResourceNotVisibleError("Channel", channelId);
      }

      return { serverId: channel.serverId, channelId };
    }

    const categoryId = params["categoryId"];

    if (categoryId !== undefined) {
      const category = await this.prisma.db.category.findUnique({
        where: { id: categoryId },
        select: { serverId: true },
      });

      if (!category) {
        throw new ResourceNotVisibleError("Category", categoryId);
      }

      return { serverId: category.serverId };
    }

    const roleId = params["roleId"];

    if (roleId !== undefined) {
      const role = await this.prisma.db.role.findUnique({
        where: { id: roleId },
        select: { serverId: true },
      });

      if (!role) {
        throw new ResourceNotVisibleError("Role", roleId);
      }

      return { serverId: role.serverId };
    }

    const memberId = params["memberId"];

    if (memberId !== undefined) {
      const member = await this.prisma.db.member.findUnique({
        where: { id: memberId },
        select: { serverId: true },
      });

      if (!member) {
        throw new ResourceNotVisibleError("Member", memberId);
      }

      return { serverId: member.serverId };
    }

    const inviteCode = params["code"];

    if (inviteCode !== undefined) {
      const invite = await this.prisma.db.invite.findUnique({
        where: { code: inviteCode },
        select: { serverId: true },
      });

      if (!invite) {
        throw new ResourceNotVisibleError("Invite", inviteCode);
      }

      return { serverId: invite.serverId };
    }

    const serverId = params["serverId"];

    if (serverId === undefined) {
      throw new Error(
        "PermissionGuard needs one of :serverId, :channelId, :categoryId, :roleId, :memberId or :code",
      );
    }

    return { serverId };
  }
}
