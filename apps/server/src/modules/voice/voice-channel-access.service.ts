import { Inject, Injectable } from "@nestjs/common";
import { ChannelType } from "@prisma/client";
import { hasPermission, Permission } from "@voreli/shared";

import { PrismaService } from "../../infra/database/prisma.service.js";
import {
  PERMISSION_RESOLVER,
  type PermissionResolverContract,
} from "../permissions/permission-resolver.contract.js";
import {
  VoiceChannelNotAvailableError,
  VoiceConnectForbiddenError,
} from "./errors/voice-room-errors.js";

@Injectable()
export class VoiceChannelAccessService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PERMISSION_RESOLVER) private readonly permissions: PermissionResolverContract,
  ) {}

  async assertConnect(userId: string, channelId: string): Promise<void> {
    const [channel, resolved] = await Promise.all([
      this.prisma.db.channel.findUnique({ where: { id: channelId }, select: { type: true } }),
      this.permissions.forChannel(userId, channelId),
    ]);

    if (!channel || channel.type !== ChannelType.VOICE || !resolved) {
      throw new VoiceChannelNotAvailableError();
    }

    if (!hasPermission(resolved.channelPermissions, Permission.Connect)) {
      throw new VoiceConnectForbiddenError();
    }
  }

  async canSpeak(userId: string, channelId: string): Promise<boolean> {
    const resolved = await this.permissions.forChannel(userId, channelId);
    return resolved !== null && hasPermission(resolved.channelPermissions, Permission.Speak);
  }

  async canConnect(userId: string, channelId: string): Promise<boolean> {
    const [channel, resolved] = await Promise.all([
      this.prisma.db.channel.findUnique({ where: { id: channelId }, select: { type: true } }),
      this.permissions.forChannel(userId, channelId),
    ]);
    return (
      channel?.type === ChannelType.VOICE &&
      resolved !== null &&
      hasPermission(resolved.channelPermissions, Permission.Connect)
    );
  }
}
