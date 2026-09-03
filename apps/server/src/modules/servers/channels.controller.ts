import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Put,
  UseGuards,
} from "@nestjs/common";
import { type ChannelView, parsePermissions, Permission } from "@voreli/shared";

import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { CurrentPermissions } from "../permissions/current-permissions.decorator.js";
import { type PermissionContext, PermissionGuard } from "../permissions/permission.guard.js";
import { RequirePermission } from "../permissions/require-permission.decorator.js";
import { ChannelManagementService } from "./channel-management.service.js";
import { SetOverrideDto, UpdateChannelDto } from "./dto/server.dto.js";
import { RoleManagementService } from "./role-management.service.js";
import { ServerPresenter } from "./server-presenter.js";

@Controller("channels")
@UseGuards(AccessTokenGuard, PermissionGuard)
export class ChannelsController {
  constructor(
    private readonly channels: ChannelManagementService,
    private readonly roles: RoleManagementService,
    private readonly presenter: ServerPresenter,
  ) {}

  @Patch(":channelId")
  @RequirePermission(Permission.ManageChannels)
  async update(
    @Param("channelId") channelId: string,
    @Body() dto: UpdateChannelDto,
  ): Promise<ChannelView> {
    return this.presenter.channel(await this.channels.updateChannel(channelId, dto));
  }

  @Delete(":channelId")
  @RequirePermission(Permission.ManageChannels)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("channelId") channelId: string): Promise<void> {
    await this.channels.deleteChannel(channelId);
  }

  @Put(":channelId/overrides")
  @RequirePermission(Permission.ManageRoles)
  @HttpCode(HttpStatus.NO_CONTENT)
  async setOverride(
    @Param("channelId") channelId: string,
    @Body() dto: SetOverrideDto,
    @CurrentPermissions() permissions: PermissionContext,
  ): Promise<void> {
    await this.roles.setOverride(channelId, permissions.effective, {
      roleId: dto.roleId,
      memberId: dto.memberId,
      allow: parsePermissions(dto.allow),
      deny: parsePermissions(dto.deny),
    });
  }

  @Delete(":channelId/overrides/:targetId")
  @RequirePermission(Permission.ManageRoles)
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearOverride(
    @Param("channelId") channelId: string,
    @Param("targetId") targetId: string,
  ): Promise<void> {
    await this.roles.clearOverride(channelId, targetId);
  }
}
