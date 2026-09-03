import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hasPermission, Permission } from "@voreli/shared";

import type { AuthenticatedRequest } from "../auth/access-token.guard.js";
import {
  MissingPermissionError,
  ResourceNotVisibleError,
} from "./errors/permission-errors.js";
import { PermissionResolver, type ResolvedMembership } from "./permission-resolver.service.js";
import { REQUIRED_PERMISSION } from "./require-permission.decorator.js";
import { ResourceLocator } from "./resource-locator.service.js";

export interface PermissionContext extends ResolvedMembership {
  /** Mask that applies to the addressed resource: channel-level when the route names one. */
  readonly effective: bigint;
}

export interface RequestWithPermissions extends AuthenticatedRequest {
  permissions?: PermissionContext;
}

/**
 * Resolves the caller's rights over whatever the route addresses and enforces the
 * permission declared with @RequirePermission.
 *
 * Controllers never check rights themselves. A permission verified in one place cannot be
 * forgotten in another, and the check is visible in the route's signature.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: PermissionResolver,
    private readonly locator: ResourceLocator,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithPermissions>();
    const auth = request.auth;

    if (!auth) {
      throw new Error("PermissionGuard used on a route that is not behind AccessTokenGuard");
    }

    const resolved = await this.resolve(request, auth.user.id);
    request.permissions = resolved;

    const required = this.reflector.getAllAndOverride<bigint | undefined>(REQUIRED_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required !== undefined && !hasPermission(resolved.effective, required)) {
      throw new MissingPermissionError(required);
    }

    return true;
  }

  private async resolve(
    request: RequestWithPermissions,
    userId: string,
  ): Promise<PermissionContext> {
    const params = request.params as Record<string, string | undefined>;
    const target = await this.locator.locate(params);

    if (target.channelId !== undefined) {
      const resolved = await this.resolver.forChannel(userId, target.channelId);

      // Not a member, or the channel hides itself from this member: to the caller both are
      // "does not exist". A 403 here would confirm the channel is real.
      if (!resolved || !hasPermission(resolved.channelPermissions, Permission.ViewChannel)) {
        throw new ResourceNotVisibleError("Channel", target.channelId);
      }

      return { ...resolved, effective: resolved.channelPermissions };
    }

    const resolved = await this.resolver.forServer(userId, target.serverId);

    if (!resolved) {
      throw new ResourceNotVisibleError("Server", target.serverId);
    }

    return { ...resolved, effective: resolved.serverPermissions };
  }
}
