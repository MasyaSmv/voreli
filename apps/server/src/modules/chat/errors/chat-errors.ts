import { HttpStatus } from "@nestjs/common";

import { DomainError } from "../../../common/errors/domain-error.js";
import type { HttpMappable } from "../../../common/errors/http-mappable.js";

export class MessageNotFoundError extends DomainError implements HttpMappable {
  static readonly CODE = "MESSAGE_NOT_FOUND";
  readonly errorCode = MessageNotFoundError.CODE;
  readonly httpStatus = HttpStatus.NOT_FOUND;

  constructor(readonly messageId: string) {
    super(`Message ${messageId} does not exist`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { messageId: this.messageId };
  }
}

/** Editing someone else's message needs MANAGE_MESSAGES; editing your own never does. */
export class NotMessageAuthorError extends DomainError implements HttpMappable {
  static readonly CODE = "NOT_MESSAGE_AUTHOR";
  readonly errorCode = NotMessageAuthorError.CODE;
  readonly httpStatus = HttpStatus.FORBIDDEN;

  constructor(readonly messageId: string) {
    super(`Message ${messageId} was written by someone else`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { messageId: this.messageId };
  }
}

export class ReplyTargetNotInChannelError extends DomainError implements HttpMappable {
  static readonly CODE = "REPLY_TARGET_NOT_IN_CHANNEL";
  readonly errorCode = ReplyTargetNotInChannelError.CODE;
  readonly httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(readonly replyToId: string) {
    super(`Message ${replyToId} is not in this channel`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { replyToId: this.replyToId };
  }
}

/** A text channel is the only kind you can write into; voice channels carry no history. */
export class NotATextChannelError extends DomainError implements HttpMappable {
  static readonly CODE = "NOT_A_TEXT_CHANNEL";
  readonly errorCode = NotATextChannelError.CODE;
  readonly httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(readonly channelId: string) {
    super(`Channel ${channelId} is not a text channel`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { channelId: this.channelId };
  }
}
