import { createHash, randomBytes } from "node:crypto";

import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { CLOCK, type Clock } from "../../common/services/clock.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../common/events/domain-event-bus.js";
import { ID_GENERATOR, type IdGenerator } from "../../common/services/id-generator.js";
import type { EnvironmentVariables } from "../../config/env.validation.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import { InvalidRefreshTokenError, SessionReuseDetectedError } from "./errors/auth-errors.js";

export interface IssuedRefreshToken {
  readonly sessionId: string;
  readonly userId: string;
  /** The only moment the raw token exists; afterwards the database holds just its hash. */
  readonly token: string;
  readonly expiresAt: Date;
}

export interface SessionOrigin {
  readonly userAgent: string | null;
  readonly ip: string | null;
}

/**
 * Issues, rotates and revokes long-lived sessions.
 *
 * The refresh token is 32 random bytes rather than a JWT: a refresh token must be
 * revocable, and revoking a JWT means checking the database anyway — at which point the
 * signature is ceremony. Only the SHA-256 of the token is stored, so a database dump
 * cannot be replayed as a live session.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async issue(userId: string, origin: SessionOrigin): Promise<IssuedRefreshToken> {
    const token = randomBytes(32).toString("base64url");
    const sessionId = this.ids.generate();
    const expiresAt = this.expiryFromNow();

    await this.prisma.db.refreshSession.create({
      data: {
        id: sessionId,
        userId,
        tokenHash: this.hash(token),
        userAgent: origin.userAgent,
        ip: origin.ip,
        expiresAt,
      },
    });

    return { sessionId, userId, token, expiresAt };
  }

  /**
   * Exchanges a refresh token for a fresh one, revoking the presented session.
   *
   * A token belonging to an already revoked session means the same secret is in two places
   * at once. There is no way to tell the legitimate holder from the thief, so both lose:
   * every session of that user is revoked.
   */
  async rotate(token: string, origin: SessionOrigin): Promise<IssuedRefreshToken> {
    const session = await this.prisma.db.refreshSession.findUnique({
      where: { tokenHash: this.hash(token) },
    });

    if (!session) {
      throw new InvalidRefreshTokenError("unknown");
    }

    if (session.revokedAt !== null) {
      throw await this.punishReuse(session.userId);
    }

    if (session.expiresAt.getTime() <= this.clock.now().getTime()) {
      throw new InvalidRefreshTokenError("expired");
    }

    // Revoking the old session and issuing the new one must be one atomic step, or a
    // crash between them logs the user out for good.
    const outcome = await this.prisma.runInTransaction(async () => {
      const claimed = await this.prisma.db.refreshSession.updateMany({
        // The revokedAt condition is what makes two simultaneous refreshes with the same
        // cookie safe: exactly one of them updates a row, the other sees count 0.
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: this.clock.now() },
      });

      if (claimed.count === 0) {
        return { claimed: false as const };
      }

      return { claimed: true as const, issued: await this.issue(session.userId, origin) };
    });

    if (!outcome.claimed) {
      throw await this.punishReuse(session.userId);
    }

    return outcome.issued;
  }

  /**
   * Revokes everything this user holds and builds the error to throw.
   *
   * Deliberately outside any transaction: throwing from inside one would roll the
   * revocation back, and the response would claim sessions were killed while they quietly
   * stayed alive.
   */
  private async punishReuse(userId: string): Promise<SessionReuseDetectedError> {
    const revoked = await this.revokeAllOf(userId);
    this.logger.warn(
      `Refresh token replay detected for user ${userId}; revoked ${String(revoked)} sessions`,
    );

    return new SessionReuseDetectedError(userId, revoked);
  }

  async revokeByToken(token: string): Promise<void> {
    const session = await this.prisma.db.refreshSession.findUnique({
      where: { tokenHash: this.hash(token) },
      select: { id: true, userId: true },
    });

    if (!session) {
      return;
    }

    const revoked = await this.prisma.db.refreshSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });

    if (revoked.count > 0) {
      await this.events.publish("session.revoked", {
        sessionId: session.id,
        userId: session.userId,
      });
    }
  }

  async revokeById(sessionId: string): Promise<void> {
    const session = await this.prisma.db.refreshSession.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true },
    });

    if (!session) {
      return;
    }

    const revoked = await this.prisma.db.refreshSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });

    if (revoked.count > 0) {
      await this.events.publish("session.revoked", {
        sessionId: session.id,
        userId: session.userId,
      });
    }
  }

  async revokeAllOf(userId: string): Promise<number> {
    // Include already-revoked sessions: a socket may still be bound to the session that
    // was rotated before its client sent auth:refresh. Theft punishment must kill it too.
    const sessions = await this.prisma.db.refreshSession.findMany({
      where: { userId },
      select: { id: true },
    });
    const result = await this.prisma.db.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });

    await Promise.all(
      sessions.map((session) =>
        this.events.publish("session.revoked", { sessionId: session.id, userId }),
      ),
    );

    return result.count;
  }

  private expiryFromNow(): Date {
    const days = this.config.get("REFRESH_TOKEN_TTL_DAYS", { infer: true });

    return new Date(this.clock.now().getTime() + days * 24 * 60 * 60 * 1000);
  }

  private hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
