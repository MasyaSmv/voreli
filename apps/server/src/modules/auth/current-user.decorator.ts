import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { User } from "@prisma/client";

import type { AuthenticatedRequest } from "./access-token.guard.js";

export interface AuthContext {
  readonly user: User;
  readonly sessionId: string;
}

/** Reads what AccessTokenGuard put on the request. Only valid behind that guard. */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.auth) {
      throw new Error("CurrentAuth used on a route that is not behind AccessTokenGuard");
    }

    return request.auth;
  },
);
