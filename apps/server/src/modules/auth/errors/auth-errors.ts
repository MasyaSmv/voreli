import { HttpStatus } from "@nestjs/common";

import { DomainError } from "../../../common/errors/domain-error.js";
import type { HttpMappable } from "../../../common/errors/http-mappable.js";

export class UsernameTakenError extends DomainError implements HttpMappable {
  static readonly CODE = "USERNAME_TAKEN";
  readonly errorCode = UsernameTakenError.CODE;
  readonly httpStatus = HttpStatus.CONFLICT;

  constructor(readonly username: string) {
    super(`Username ${username} is already taken`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { username: this.username };
  }
}

/**
 * Deliberately says nothing about which half was wrong. Distinguishing "no such user" from
 * "wrong password" turns the login form into a directory of who is registered here.
 */
export class InvalidCredentialsError extends DomainError implements HttpMappable {
  static readonly CODE = "INVALID_CREDENTIALS";
  readonly errorCode = InvalidCredentialsError.CODE;
  readonly httpStatus = HttpStatus.UNAUTHORIZED;

  constructor() {
    super("Username or password is incorrect");
  }
}

export class InvalidRefreshTokenError extends DomainError implements HttpMappable {
  static readonly CODE = "INVALID_REFRESH_TOKEN";
  readonly errorCode = InvalidRefreshTokenError.CODE;
  readonly httpStatus = HttpStatus.UNAUTHORIZED;

  constructor(readonly reason: "unknown" | "expired" | "revoked") {
    super(`Refresh token is not usable: ${reason}`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { reason: this.reason };
  }
}

/**
 * A refresh token that was already rotated came back. Either the user restored an old
 * backup, or someone copied the cookie — and the two are indistinguishable from here, so
 * the safe reading is theft: every session of that user is killed.
 */
export class SessionReuseDetectedError extends DomainError implements HttpMappable {
  static readonly CODE = "SESSION_REUSE_DETECTED";
  readonly errorCode = SessionReuseDetectedError.CODE;
  readonly httpStatus = HttpStatus.UNAUTHORIZED;

  constructor(
    readonly userId: string,
    readonly sessionsRevoked: number,
  ) {
    super(
      `Refresh token of an already rotated session was replayed; revoked ${String(sessionsRevoked)} sessions of user ${userId}`,
    );
  }

  override context(): Readonly<Record<string, unknown>> {
    return { userId: this.userId, sessionsRevoked: this.sessionsRevoked };
  }
}

export class SessionNotFoundError extends DomainError implements HttpMappable {
  static readonly CODE = "SESSION_NOT_FOUND";
  readonly errorCode = SessionNotFoundError.CODE;
  readonly httpStatus = HttpStatus.NOT_FOUND;

  constructor(readonly sessionId: string) {
    super(`Session ${sessionId} does not exist or does not belong to this user`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { sessionId: this.sessionId };
  }
}
