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
import { parsePermissions, Permission, type RoleView } from "@voreli/shared";

import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { CurrentPermissions } from "../permissions/current-permissions.decorator.js";
import { type PermissionContext, PermissionGuard } from "../permissions/permission.guard.js";
import { RequirePermission } from "../permissions/require-permission.decorator.js";
import { UpdateRoleDto } from "./dto/server.dto.js";
import { RoleManagementService } from "./role-management.service.js";
import { ServerPresenter } from "./server-presenter.js";

@Controller()
@UseGuards(AccessTokenGuard, PermissionGuard)
export class RolesController {
  constructor(
    private readonly roles: RoleManagementService,
    private readonly presenter: ServerPresenter,
  ) {}

  @Patch("roles/:roleId")
  @RequirePermission(Permission.ManageRoles)
  async update(
    @Param("roleId") roleId: string,
    @Body() dto: UpdateRoleDto,
    @CurrentPermissions() permissions: PermissionContext,
  ): Promise<RoleView> {
    const role = await this.roles.update(roleId, permissions.effective, {
      name: dto.name,
      color: dto.color,
      position: dto.position,
      permissions: dto.permissions === undefined ? undefined : parsePermissions(dto.permissions),
    });

    return this.presenter.role(role);
  }

  @Delete("roles/:roleId")
  @RequirePermission(Permission.ManageRoles)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("roleId") roleId: string): Promise<void> {
    await this.roles.remove(roleId);
  }

  @Put("members/:memberId/roles/:roleId")
  @RequirePermission(Permission.ManageRoles)
  @HttpCode(HttpStatus.NO_CONTENT)
  async assign(
    @Param("memberId") memberId: string,
    @Param("roleId") roleId: string,
    @CurrentPermissions() permissions: PermissionContext,
  ): Promise<void> {
    await this.roles.assignTo(memberId, roleId, permissions.effective);
  }

  @Delete("members/:memberId/roles/:roleId")
  @RequirePermission(Permission.ManageRoles)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Param("memberId") memberId: string,
    @Param("roleId") roleId: string,
    @CurrentPermissions() permissions: PermissionContext,
  ): Promise<void> {
    await this.roles.revokeFrom(memberId, roleId, permissions.effective);
  }
}
