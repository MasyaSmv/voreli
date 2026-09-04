import { Module } from "@nestjs/common";

import { CachedPermissionResolver } from "./cached-permission-resolver.js";
import { PERMISSION_RESOLVER } from "./permission-resolver.contract.js";
import { PermissionGuard } from "./permission.guard.js";
import { DatabasePermissionResolver } from "./permission-resolver.service.js";
import { ResourceLocator } from "./resource-locator.service.js";

/**
 * The token resolves to the cache, and the cache holds the database resolver. Swapping the
 * two — or dropping the cache entirely — is a change to this file and nowhere else.
 */
@Module({
  providers: [
    DatabasePermissionResolver,
    CachedPermissionResolver,
    { provide: PERMISSION_RESOLVER, useExisting: CachedPermissionResolver },
    PermissionGuard,
    ResourceLocator,
  ],
  exports: [PERMISSION_RESOLVER, PermissionGuard, ResourceLocator],
})
export class PermissionsModule {}
