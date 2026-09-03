import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

import type { PermissionContext, RequestWithPermissions } from "./permission.guard.js";

/** Reads what PermissionGuard resolved. Only valid on routes behind that guard. */
export const CurrentPermissions = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PermissionContext => {
    const request = context.switchToHttp().getRequest<RequestWithPermissions>();

    if (!request.permissions) {
      throw new Error("CurrentPermissions used on a route that is not behind PermissionGuard");
    }

    return request.permissions;
  },
);
