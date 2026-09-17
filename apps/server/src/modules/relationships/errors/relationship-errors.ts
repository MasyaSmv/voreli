import { HttpStatus } from "@nestjs/common";

import { DomainError } from "../../../common/errors/domain-error.js";
import type { HttpMappable } from "../../../common/errors/http-mappable.js";

export class ContactNotFoundError extends DomainError implements HttpMappable {
  static readonly CODE = "CONTACT_NOT_FOUND";
  readonly errorCode = ContactNotFoundError.CODE;
  readonly httpStatus = HttpStatus.NOT_FOUND;

  constructor(readonly username: string) {
    super("User does not exist or is not available");
  }

  override context(): Readonly<Record<string, unknown>> {
    return { username: this.username };
  }
}

export class ContactActionNotAllowedError extends DomainError implements HttpMappable {
  static readonly CODE = "CONTACT_ACTION_NOT_ALLOWED";
  readonly errorCode = ContactActionNotAllowedError.CODE;
  readonly httpStatus = HttpStatus.FORBIDDEN;

  constructor(
    readonly action: "message" | "call" | "friendRequest",
    readonly targetUserId: string,
  ) {
    super("This contact does not allow the requested action");
  }

  override context(): Readonly<Record<string, unknown>> {
    return { action: this.action, targetUserId: this.targetUserId };
  }
}

export class RelationshipConflictError extends DomainError implements HttpMappable {
  static readonly CODE = "RELATIONSHIP_CONFLICT";
  readonly errorCode = RelationshipConflictError.CODE;
  readonly httpStatus = HttpStatus.CONFLICT;

  constructor(
    message: string,
    readonly userId: string,
    readonly targetUserId: string,
  ) {
    super(message);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { userId: this.userId, targetUserId: this.targetUserId };
  }
}

export class FriendRequestNotFoundError extends DomainError implements HttpMappable {
  static readonly CODE = "FRIEND_REQUEST_NOT_FOUND";
  readonly errorCode = FriendRequestNotFoundError.CODE;
  readonly httpStatus = HttpStatus.NOT_FOUND;

  constructor(readonly requestId: string) {
    super("Friend request does not exist or is not available");
  }

  override context(): Readonly<Record<string, unknown>> {
    return { requestId: this.requestId };
  }
}

export class DirectConversationNotFoundError extends DomainError implements HttpMappable {
  static readonly CODE = "DIRECT_CONVERSATION_NOT_FOUND";
  readonly errorCode = DirectConversationNotFoundError.CODE;
  readonly httpStatus = HttpStatus.NOT_FOUND;

  constructor(readonly conversationId: string) {
    super("Direct conversation does not exist or is not available");
  }

  override context(): Readonly<Record<string, unknown>> {
    return { conversationId: this.conversationId };
  }
}
