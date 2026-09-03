import { Module } from "@nestjs/common";

import { PermissionGuard } from "./permission.guard.js";
import { PermissionResolver } from "./permission-resolver.service.js";
import { ResourceLocator } from "./resource-locator.service.js";

@Module({
  providers: [PermissionResolver, PermissionGuard, ResourceLocator],
  exports: [PermissionResolver, PermissionGuard, ResourceLocator],
})
export class PermissionsModule {}
