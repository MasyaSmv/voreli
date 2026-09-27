import { HttpStatus } from "@nestjs/common";

import { DomainError } from "../../../common/errors/domain-error.js";
import type { HttpMappable } from "../../../common/errors/http-mappable.js";

abstract class UploadRequestError extends DomainError implements HttpMappable {
  readonly httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;
}

export class UnsupportedUploadTypeError extends UploadRequestError {
  static readonly CODE = "UNSUPPORTED_UPLOAD_TYPE";
  readonly errorCode = UnsupportedUploadTypeError.CODE;

  constructor(
    readonly fileName: string,
    readonly declaredMime: string,
    readonly purpose: string,
  ) {
    super(`File ${fileName} with type ${declaredMime} is not allowed for ${purpose}`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { fileName: this.fileName, declaredMime: this.declaredMime, purpose: this.purpose };
  }
}

export class UploadTooLargeError extends UploadRequestError {
  static readonly CODE = "UPLOAD_TOO_LARGE";
  readonly errorCode = UploadTooLargeError.CODE;

  constructor(
    readonly byteSize: number,
    readonly limit: number,
  ) {
    super(`Upload size ${String(byteSize)} exceeds limit ${String(limit)}`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { byteSize: this.byteSize, limit: this.limit };
  }
}

export class TooManyActiveUploadsError extends UploadRequestError {
  static readonly CODE = "TOO_MANY_ACTIVE_UPLOADS";
  readonly errorCode = TooManyActiveUploadsError.CODE;

  constructor(readonly ownerId: string) {
    super("Too many active upload reservations");
  }

  override context(): Readonly<Record<string, unknown>> {
    return { ownerId: this.ownerId };
  }
}

export class UploadNotFoundError extends DomainError implements HttpMappable {
  static readonly CODE = "UPLOAD_NOT_FOUND";
  readonly errorCode = UploadNotFoundError.CODE;
  readonly httpStatus = HttpStatus.NOT_FOUND;

  constructor(readonly uploadId: string) {
    super(`Upload ${uploadId} does not exist`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { uploadId: this.uploadId };
  }
}

export class UploadNotOwnedError extends DomainError implements HttpMappable {
  static readonly CODE = "UPLOAD_NOT_OWNED";
  readonly errorCode = UploadNotOwnedError.CODE;
  readonly httpStatus = HttpStatus.FORBIDDEN;

  constructor(readonly uploadId: string) {
    super(`Upload ${uploadId} belongs to another user`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { uploadId: this.uploadId };
  }
}

export class UploadExpiredError extends UploadRequestError {
  static readonly CODE = "UPLOAD_EXPIRED";
  readonly errorCode = UploadExpiredError.CODE;

  constructor(readonly uploadId: string) {
    super(`Upload ${uploadId} reservation has expired`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { uploadId: this.uploadId };
  }
}

export class UploadObjectMissingError extends UploadRequestError {
  static readonly CODE = "UPLOAD_OBJECT_MISSING";
  readonly errorCode = UploadObjectMissingError.CODE;

  constructor(readonly uploadId: string) {
    super(`Object for upload ${uploadId} has not been uploaded`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { uploadId: this.uploadId };
  }
}

export class UploadSizeMismatchError extends UploadRequestError {
  static readonly CODE = "UPLOAD_SIZE_MISMATCH";
  readonly errorCode = UploadSizeMismatchError.CODE;

  constructor(
    readonly uploadId: string,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`Object size ${String(actual)} does not match reserved size ${String(expected)}`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { uploadId: this.uploadId, expected: this.expected, actual: this.actual };
  }
}

export class UploadNotReadyError extends UploadRequestError {
  static readonly CODE = "UPLOAD_NOT_READY";
  readonly errorCode = UploadNotReadyError.CODE;

  constructor(readonly uploadId: string) {
    super(`Upload ${uploadId} is not ready`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { uploadId: this.uploadId };
  }
}

export class UploadRejectedError extends DomainError {
  static readonly CODE = "UPLOAD_REJECTED";
  readonly errorCode = UploadRejectedError.CODE;

  constructor(
    readonly uploadId: string,
    readonly rejectionCode: string,
  ) {
    super(`Upload ${uploadId} was rejected: ${rejectionCode}`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { uploadId: this.uploadId, rejectionCode: this.rejectionCode };
  }
}
