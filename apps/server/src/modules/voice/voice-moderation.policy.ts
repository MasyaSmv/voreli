import { Inject, Injectable } from "@nestjs/common";
import { ChannelType } from "@prisma/client";
import { hasPermission, Permission, type SetVoiceModeratorStatePayload } from "@voreli/shared";

import { PrismaService } from "../../infra/database/prisma.service.js";
import {
  PERMISSION_RESOLVER,
  type PermissionResolverContract,
} from "../permissions/permission-resolver.contract.js";
import {
  VoiceModerationHierarchyError,
  VoiceModerationPermissionError,
  VoiceModerationSelfError,
  VoiceModerationTargetNotPresentError,
} from "./errors/voice-room-errors.js";
import type { VoiceParticipantState } from "./voice-state.repository.js";

@Injectable()
export class VoiceModerationPolicy {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PERMISSION_RESOLVER) private readonly permissions: PermissionResolverContract,
  ) {}

  async assertAllowed(
    actorId: string,
    payload: SetVoiceModeratorStatePayload,
    target: VoiceParticipantState,
  ): Promise<void> {
    if (actorId === payload.userId) throw new VoiceModerationSelfError();

    const [channel, actorPermissions] = await Promise.all([
      this.prisma.db.channel.findUnique({
        where: { id: payload.channelId },
        select: { type: true, serverId: true, server: { select: { ownerId: true } } },
      }),
      this.permissions.forChannel(actorId, payload.channelId),
    ]);
    if (
      !channel ||
      channel.type !== ChannelType.VOICE ||
      !actorPermissions ||
      target.userId !== payload.userId
    ) {
      throw new VoiceModerationTargetNotPresentError(payload.userId);
    }

    if (
      target.moderatorMuted !== payload.moderatorMuted &&
      !hasPermission(actorPermissions.channelPermissions, Permission.MuteMembers)
    ) {
      throw new VoiceModerationPermissionError("MuteMembers");
    }
    if (
      target.moderatorDeafened !== payload.moderatorDeafened &&
      !hasPermission(actorPermissions.channelPermissions, Permission.DeafenMembers)
    ) {
      throw new VoiceModerationPermissionError("DeafenMembers");
    }

    if (channel.server.ownerId === payload.userId) throw new VoiceModerationHierarchyError();
    if (channel.server.ownerId === actorId) return;

    const members = await this.prisma.db.member.findMany({
      where: { serverId: channel.serverId, userId: { in: [actorId, payload.userId] } },
      select: {
        userId: true,
        roles: { select: { role: { select: { position: true } } } },
      },
    });
    const actor = members.find((member) => member.userId === actorId);
    const moderated = members.find((member) => member.userId === payload.userId);
    if (!actor || !moderated) throw new VoiceModerationTargetNotPresentError(payload.userId);

    const highest = (positions: readonly { readonly role: { readonly position: number } }[]) =>
      Math.max(0, ...positions.map((entry) => entry.role.position));
    if (highest(actor.roles) <= highest(moderated.roles)) {
      throw new VoiceModerationHierarchyError();
    }
  }
}
