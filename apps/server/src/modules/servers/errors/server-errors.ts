import { HttpStatus } from "@nestjs/common";

import { DomainError } from "../../../common/errors/domain-error.js";
import type { HttpMappable } from "../../../common/errors/http-mappable.js";

export class DefaultRoleImmutableError extends DomainError implements HttpMappable {
  static readonly CODE = "DEFAULT_ROLE_IMMUTABLE";
  readonly errorCode = DefaultRoleImmutableError.CODE;
  readonly httpStatus = HttpStatus.CONFLICT;

  constructor(readonly roleId: string) {
    super("The @everyone role cannot be deleted: permission resolution starts from it");
  }

  override context(): Readonly<Record<string, unknown>> {
    return { roleId: this.roleId };
  }
}

/** A role, channel or member addressed across server boundaries. */
export class CrossServerReferenceError extends DomainError implements HttpMappable {
  static readonly CODE = "CROSS_SERVER_REFERENCE";
  readonly errorCode = CrossServerReferenceError.CODE;
  readonly httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(
    readonly kind: string,
    readonly id: string,
  ) {
    super(`${kind} ${id} belongs to a different server`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { kind: this.kind, id: this.id };
  }
}

export class OwnerOnlyActionError extends DomainError implements HttpMappable {
  static readonly CODE = "OWNER_ONLY";
  readonly errorCode = OwnerOnlyActionError.CODE;
  readonly httpStatus = HttpStatus.FORBIDDEN;

  constructor(readonly action: string) {
    super(`Only the server owner may ${action}`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { action: this.action };
  }
}

/** Exactly one of roleId / memberId must identify an override target. */
export class InvalidOverrideTargetError extends DomainError implements HttpMappable {
  static readonly CODE = "INVALID_OVERRIDE_TARGET";
  readonly errorCode = InvalidOverrideTargetError.CODE;
  readonly httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor() {
    super("A channel override targets exactly one of a role or a member");
  }
}
