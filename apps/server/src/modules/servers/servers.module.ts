import { Module } from "@nestjs/common";

import { RateLimitModule } from "../../common/rate-limit/rate-limit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { PermissionsModule } from "../permissions/permissions.module.js";
import { CategoriesController } from "./categories.controller.js";
import { ChannelManagementService } from "./channel-management.service.js";
import { ChannelsController } from "./channels.controller.js";
import { InviteManagementService } from "./invite-management.service.js";
import { InvitesController } from "./invites.controller.js";
import { RoleManagementService } from "./role-management.service.js";
import { RolesController } from "./roles.controller.js";
import { ServerAdministrationService } from "./server-administration.service.js";
import { ServerCreationService } from "./server-creation.service.js";
import { ServerPresenter } from "./server-presenter.js";
import { ServerViewService } from "./server-view.service.js";
import { ServersController } from "./servers.controller.js";

@Module({
  imports: [AuthModule, PermissionsModule, RateLimitModule],
  controllers: [
    ServersController,
    ChannelsController,
    CategoriesController,
    RolesController,
    InvitesController,
  ],
  providers: [
    ServerCreationService,
    ServerAdministrationService,
    ServerViewService,
    ChannelManagementService,
    RoleManagementService,
    InviteManagementService,
    ServerPresenter,
  ],
})
export class ServersModule {}
