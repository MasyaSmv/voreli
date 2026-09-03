import { Injectable } from "@nestjs/common";
import type { SessionListResponse, SessionSummary } from "@voreli/shared";

import { PrismaService } from "../../infra/database/prisma.service.js";
import { SessionNotFoundError } from "./errors/auth-errors.js";
import { RefreshTokenService } from "./refresh-token.service.js";

/**
 * "Where am I logged in" and "log that one out". Separate from token issuing because it is
 * a different job: one mints credentials, the other reports and withdraws them.
 */
@Injectable()
export class SessionListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async listFor(userId: string, currentSessionId: string): Promise<SessionListResponse> {
    const sessions = await this.prisma.db.refreshSession.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });

    const summaries: SessionSummary[] = sessions.map((session) => ({
      id: session.id,
      userAgent: session.userAgent,
      ip: session.ip,
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      current: session.id === currentSessionId,
    }));

    return { sessions: summaries };
  }

  /** Revoking someone else's session must be impossible, hence the ownership check. */
  async revokeFor(userId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.db.refreshSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true },
    });

    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }

    await this.refreshTokens.revokeById(sessionId);
  }
}
