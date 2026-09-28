import { HttpStatus } from "@nestjs/common";

import { DomainError } from "../../../common/errors/domain-error.js";
import type { HttpMappable } from "../../../common/errors/http-mappable.js";

export class AttachmentNotFoundError extends DomainError implements HttpMappable {
  static readonly CODE = "ATTACHMENT_NOT_FOUND";
  readonly errorCode = AttachmentNotFoundError.CODE;
  readonly httpStatus = HttpStatus.NOT_FOUND;

  constructor(readonly attachmentId: string) {
    super(`Attachment ${attachmentId} is not available`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { attachmentId: this.attachmentId };
  }
}
