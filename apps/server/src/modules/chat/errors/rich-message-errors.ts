import { HttpStatus } from "@nestjs/common";
import { DomainError } from "../../../common/errors/domain-error.js";
import type { HttpMappable } from "../../../common/errors/http-mappable.js";

export class InvalidMessageError extends DomainError implements HttpMappable {
  static readonly CODE = "INVALID_MESSAGE";
  readonly errorCode = InvalidMessageError.CODE;
  readonly httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;
  constructor() {
    super("A message requires text or up to ten unique ready attachments");
  }
}
export class AttachmentAlreadyUsedError extends DomainError implements HttpMappable {
  static readonly CODE = "ATTACHMENT_ALREADY_USED";
  readonly errorCode = AttachmentAlreadyUsedError.CODE;
  readonly httpStatus = HttpStatus.CONFLICT;
  constructor(readonly uploadId: string) {
    super(`Upload ${uploadId} is already attached`);
  }
}
export class InvalidReactionError extends DomainError implements HttpMappable {
  static readonly CODE = "INVALID_REACTION";
  readonly errorCode = InvalidReactionError.CODE;
  readonly httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;
  constructor() {
    super("Reaction must be one emoji, at most 32 UTF-8 bytes");
  }
}
export class ReactionLimitError extends DomainError implements HttpMappable {
  static readonly CODE = "REACTION_LIMIT";
  readonly errorCode = ReactionLimitError.CODE;
  readonly httpStatus = HttpStatus.CONFLICT;
  constructor() {
    super("A user may add at most twenty reactions per message");
  }
}
