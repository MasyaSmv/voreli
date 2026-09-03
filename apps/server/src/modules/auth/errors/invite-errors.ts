import { HttpStatus } from "@nestjs/common";

import { DomainError } from "../../../common/errors/domain-error.js";
import type { HttpMappable } from "../../../common/errors/http-mappable.js";

export class InviteNotFoundError extends DomainError implements HttpMappable {
  static readonly CODE = "INVITE_NOT_FOUND";
  readonly errorCode = InviteNotFoundError.CODE;
  readonly httpStatus = HttpStatus.NOT_FOUND;

  constructor(readonly code: string) {
    super(`Invite ${code} does not exist`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { inviteCode: this.code };
  }
}

export class InviteExpiredError extends DomainError implements HttpMappable {
  static readonly CODE = "INVITE_EXPIRED";
  readonly errorCode = InviteExpiredError.CODE;
  readonly httpStatus = HttpStatus.GONE;

  constructor(
    readonly code: string,
    readonly expiredAt: Date,
  ) {
    super(`Invite ${code} expired at ${expiredAt.toISOString()}`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { inviteCode: this.code, expiredAt: this.expiredAt.toISOString() };
  }
}

export class InviteExhaustedError extends DomainError implements HttpMappable {
  static readonly CODE = "INVITE_EXHAUSTED";
  readonly errorCode = InviteExhaustedError.CODE;
  readonly httpStatus = HttpStatus.GONE;

  constructor(
    readonly code: string,
    readonly maxUses: number,
  ) {
    super(`Invite ${code} has been used ${maxUses} times, which is its limit`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { inviteCode: this.code, maxUses: this.maxUses };
  }
}
