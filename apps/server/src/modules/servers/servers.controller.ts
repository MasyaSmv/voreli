import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  type CategoryView,
  type ChannelView,
  type InviteView,
  parsePermissions,
  Permission,
  type RoleView,
  type ServerSummary,
  type ServerView,
} from "@voreli/shared";

import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { type AuthContext, CurrentAuth } from "../auth/current-user.decorator.js";
import { CurrentPermissions } from "../permissions/current-permissions.decorator.js";
import { type PermissionContext, PermissionGuard } from "../permissions/permission.guard.js";
import { RequirePermission } from "../permissions/require-permission.decorator.js";
import { ChannelManagementService } from "./channel-management.service.js";
import {
  CreateCategoryDto,
  CreateChannelDto,
  CreateInviteDto,
  CreateRoleDto,
  CreateServerDto,
  UpdateServerDto,
} from "./dto/server.dto.js";
import { OwnerOnlyActionError } from "./errors/server-errors.js";
import { InviteManagementService } from "./invite-management.service.js";
import { RoleManagementService } from "./role-management.service.js";
import { ServerAdministrationService } from "./server-administration.service.js";
import { ServerCreationService } from "./server-creation.service.js";
import { ServerPresenter } from "./server-presenter.js";
import { ServerViewService } from "./server-view.service.js";

/**
 * Everything addressed by :serverId. The permission each route needs is declared, never
 * checked by hand: PermissionGuard resolves the caller's membership from the route
 * parameter and enforces the declaration.
 */
@Controller("servers")
@UseGuards(AccessTokenGuard)
export class ServersController {
  constructor(
    private readonly creation: ServerCreationService,
    private readonly administration: ServerAdministrationService,
    private readonly view: ServerViewService,
    private readonly channels: ChannelManagementService,
    private readonly roles: RoleManagementService,
    private readonly invites: InviteManagementService,
    private readonly presenter: ServerPresenter,
  ) {}

  @Post()
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateServerDto,
  ): Promise<ServerSummary> {
    const server = await this.creation.create(auth.user.id, dto.name);

    return this.presenter.server(server, auth.user.id);
  }

  @Get()
  async mine(@CurrentAuth() auth: AuthContext): Promise<{ servers: readonly ServerSummary[] }> {
    return { servers: await this.view.listFor(auth.user.id) };
  }

  @Get(":serverId")
  @UseGuards(PermissionGuard)
  async one(
    @CurrentAuth() auth: AuthContext,
    @Param("serverId") serverId: string,
    @CurrentPermissions() permissions: PermissionContext,
  ): Promise<ServerView> {
    return this.view.viewFor(auth.user.id, serverId, permissions);
  }

  @Patch(":serverId")
  @UseGuards(PermissionGuard)
  @RequirePermission(Permission.ManageServer)
  async rename(
    @CurrentAuth() auth: AuthContext,
    @Param("serverId") serverId: string,
    @Body() dto: UpdateServerDto,
  ): Promise<ServerSummary> {
    const server =
      dto.name === undefined
        ? await this.administration.byId(serverId)
        : await this.administration.rename(serverId, dto.name);

    return this.presenter.server(server, auth.user.id);
  }

  @Delete(":serverId")
  @UseGuards(PermissionGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param("serverId") serverId: string,
    @CurrentPermissions() permissions: PermissionContext,
  ): Promise<void> {
    // Deletion takes every channel and message with it, so it stays with the one person who
    // cannot be handed the right by accident.
    if (!permissions.isOwner) {
      throw new OwnerOnlyActionError("delete the server");
    }

    await this.administration.remove(serverId);
  }

  @Post(":serverId/categories")
  @UseGuards(PermissionGuard)
  @RequirePermission(Permission.ManageChannels)
  async createCategory(
    @Param("serverId") serverId: string,
    @Body() dto: CreateCategoryDto,
  ): Promise<CategoryView> {
    return this.presenter.category(
      await this.channels.createCategory(serverId, dto.name, dto.position),
    );
  }

  @Post(":serverId/channels")
  @UseGuards(PermissionGuard)
  @RequirePermission(Permission.ManageChannels)
  async createChannel(
    @Param("serverId") serverId: string,
    @Body() dto: CreateChannelDto,
  ): Promise<ChannelView> {
    return this.presenter.channel(await this.channels.createChannel(serverId, dto));
  }

  @Post(":serverId/roles")
  @UseGuards(PermissionGuard)
  @RequirePermission(Permission.ManageRoles)
  async createRole(
    @Param("serverId") serverId: string,
    @Body() dto: CreateRoleDto,
    @CurrentPermissions() permissions: PermissionContext,
  ): Promise<RoleView> {
    const role = await this.roles.create(serverId, permissions.effective, {
      name: dto.name,
      color: dto.color,
      permissions: dto.permissions === undefined ? undefined : parsePermissions(dto.permissions),
    });

    return this.presenter.role(role);
  }

  @Post(":serverId/invites")
  @UseGuards(PermissionGuard)
  @RequirePermission(Permission.CreateInvite)
  async createInvite(
    @Param("serverId") serverId: string,
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateInviteDto,
  ): Promise<InviteView> {
    return this.invites.create(serverId, auth.user.id, dto);
  }

  @Get(":serverId/invites")
  @UseGuards(PermissionGuard)
  @RequirePermission(Permission.ManageServer)
  async listInvites(
    @Param("serverId") serverId: string,
  ): Promise<{ invites: readonly InviteView[] }> {
    return { invites: await this.invites.listFor(serverId) };
  }
}
