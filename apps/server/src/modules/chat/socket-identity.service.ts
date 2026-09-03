import { Injectable } from "@nestjs/common";
import type { User } from "@prisma/client";

import { PrismaService } from "../../infra/database/prisma.service.js";
import { AccessTokenService } from "../auth/access-token.service.js";

export interface SocketIdentity {
  readonly user: User;
  readonly sessionId: string;
}

/**
 * Turns an access token into an identity, the same way the HTTP guard does — including the
 * session check, so that logging out really does end the socket's authority and not only
 * its ability to make HTTP calls.
 */
@Injectable()
export class SocketIdentityService {
  constructor(
    private readonly tokens: AccessTokenService,
    private readonly prisma: PrismaService,
  ) {}

  async identify(token: string | undefined): Promise<SocketIdentity | null> {
    if (typeof token !== "string" || token.length === 0) {
      return null;
    }

    const claims = await this.tokens.verify(token).catch(() => null);

    if (!claims) {
      return null;
    }

    const session = await this.prisma.db.refreshSession.findUnique({
      where: { id: claims.sid },
      include: { user: true },
    });

    if (!session || session.revokedAt !== null) {
      return null;
    }

    return { user: session.user, sessionId: session.id };
  }
}
