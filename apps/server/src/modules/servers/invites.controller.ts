import { Controller, Delete, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import { type JoinedServerResponse, Permission } from "@voreli/shared";

import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { type AuthContext, CurrentAuth } from "../auth/current-user.decorator.js";
import { InviteRedemptionService } from "../auth/invite-redemption.service.js";
import { type PermissionContext, PermissionGuard } from "../permissions/permission.guard.js";
import { CurrentPermissions } from "../permissions/current-permissions.decorator.js";
import { RequirePermission } from "../permissions/require-permission.decorator.js";
import { InviteManagementService } from "./invite-management.service.js";
import { ServerAdministrationService } from "./server-administration.service.js";
import { ServerPresenter } from "./server-presenter.js";

@Controller("invites")
@UseGuards(AccessTokenGuard)
export class InvitesController {
  constructor(
    private readonly invites: InviteManagementService,
    private readonly redemption: InviteRedemptionService,
    private readonly servers: ServerAdministrationService,
    private readonly presenter: ServerPresenter,
  ) {}

  /**
   * Joining deliberately runs without PermissionGuard: the caller is not a member yet, and
   * the guard would answer 404 for every invite that actually works. The invite itself is
   * the authorisation, and its validity is checked when it is redeemed.
   */
  @Post(":code/join")
  async join(
    @Param("code") code: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<JoinedServerResponse> {
    const { serverId, memberId } = await this.redemption.redeem(code, auth.user.id);
    const server = await this.servers.byId(serverId);

    return { server: this.presenter.server(server, auth.user.id), memberId };
  }

  @Delete(":code")
  @UseGuards(PermissionGuard)
  @RequirePermission(Permission.ManageServer)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Param("code") code: string,
    @CurrentPermissions() permissions: PermissionContext,
  ): Promise<void> {
    await this.invites.revoke(permissions.serverId, code);
  }
}
