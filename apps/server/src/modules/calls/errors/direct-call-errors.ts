import { DomainError } from "../../../common/errors/domain-error.js";

export class DirectCallNotFoundError extends DomainError {
  static readonly CODE = "CALL_NOT_FOUND";
  readonly errorCode = DirectCallNotFoundError.CODE;

  constructor(readonly callId: string) {
    super("Call does not exist or is not available");
  }

  override context(): Readonly<Record<string, unknown>> {
    return { callId: this.callId };
  }
}

export class DirectCallUserBusyError extends DomainError {
  static readonly CODE = "CALL_USER_BUSY";
  readonly errorCode = DirectCallUserBusyError.CODE;

  constructor(readonly userId: string) {
    super("A call participant is already busy");
  }

  override context(): Readonly<Record<string, unknown>> {
    return { userId: this.userId };
  }
}

export class DirectCallAlreadyAnsweredError extends DomainError {
  static readonly CODE = "CALL_ALREADY_ANSWERED";
  readonly errorCode = DirectCallAlreadyAnsweredError.CODE;

  constructor(readonly callId: string) {
    super("Call was already answered on another device");
  }

  override context(): Readonly<Record<string, unknown>> {
    return { callId: this.callId };
  }
}

export class DirectCallInvalidStateError extends DomainError {
  static readonly CODE = "CALL_INVALID_STATE";
  readonly errorCode = DirectCallInvalidStateError.CODE;

  constructor(
    readonly callId: string,
    readonly status: string,
  ) {
    super(`Call cannot perform this action while it is ${status}`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { callId: this.callId, status: this.status };
  }
}
