import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { User } from "@prisma/client";
import type { Request } from "express";

import { PrismaService } from "../../infra/database/prisma.service.js";
import { AccessTokenService } from "./access-token.service.js";

export interface AuthenticatedRequest extends Request {
  auth?: { user: User; sessionId: string };
}

/**
 * Verifies the bearer token and confirms its session is still alive.
 *
 * The session lookup is a deliberate cost: without it, revoking a session would leave its
 * access tokens working until they expire, and "log out everywhere" would be a lie for the
 * next fifteen minutes. It is a primary-key read on an indexed column; when Redis arrives
 * for presence (M2), this check moves there.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly tokens: AccessTokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.bearerOf(request);

    if (token === null) {
      throw new UnauthorizedException("Access token is missing");
    }

    const claims = await this.tokens.verify(token).catch(() => {
      throw new UnauthorizedException("Access token is invalid or expired");
    });

    const session = await this.prisma.db.refreshSession.findUnique({
      where: { id: claims.sid },
      include: { user: true },
    });

    if (!session || session.revokedAt !== null) {
      throw new UnauthorizedException("Session is no longer active");
    }

    request.auth = { user: session.user, sessionId: session.id };

    return true;
  }

  private bearerOf(request: Request): string | null {
    const header = request.headers.authorization;

    if (typeof header !== "string") {
      return null;
    }

    const [scheme, value] = header.split(" ");

    return scheme === "Bearer" && value ? value : null;
  }
}
