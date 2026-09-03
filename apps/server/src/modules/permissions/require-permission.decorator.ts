import { SetMetadata } from "@nestjs/common";

export const REQUIRED_PERMISSION = "voreli:required-permission";

/**
 * Declares what a route needs. The guard reads it; the handler never checks anything by
 * hand. A permission verified in exactly one place cannot be forgotten in another.
 */
export const RequirePermission = (permission: bigint) =>
  SetMetadata(REQUIRED_PERMISSION, permission);
