import { HttpStatus } from "@nestjs/common";

import { DomainError } from "../../../common/errors/domain-error.js";
import type { HttpMappable } from "../../../common/errors/http-mappable.js";

/**
 * Answers 404, never 403, and that is a security decision rather than sloppiness: 403 would
 * confirm the thing exists, turning a private category into a table of contents of secrets.
 */
export class ResourceNotVisibleError extends DomainError implements HttpMappable {
  static readonly CODE = "NOT_FOUND";
  readonly errorCode = ResourceNotVisibleError.CODE;
  readonly httpStatus = HttpStatus.NOT_FOUND;

  constructor(
    readonly kind: string,
    readonly id: string,
  ) {
    super(`${kind} ${id} does not exist or is not visible to this user`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { kind: this.kind, id: this.id };
  }
}

/** The resource is visible, the action is not allowed. */
export class MissingPermissionError extends DomainError implements HttpMappable {
  static readonly CODE = "MISSING_PERMISSION";
  readonly errorCode = MissingPermissionError.CODE;
  readonly httpStatus = HttpStatus.FORBIDDEN;

  constructor(readonly permission: bigint) {
    super(`Caller lacks permission ${permission.toString(10)}`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { permission: this.permission.toString(10) };
  }
}

/**
 * Refuses privilege escalation: handing out rights you do not hold would turn
 * MANAGE_ROLES into Administrator in one step.
 */
export class PermissionEscalationError extends DomainError implements HttpMappable {
  static readonly CODE = "PERMISSION_ESCALATION";
  readonly errorCode = PermissionEscalationError.CODE;
  readonly httpStatus = HttpStatus.FORBIDDEN;

  constructor(readonly attempted: bigint) {
    super("Cannot grant permissions the caller does not have");
  }

  override context(): Readonly<Record<string, unknown>> {
    return { attempted: this.attempted.toString(10) };
  }
}
