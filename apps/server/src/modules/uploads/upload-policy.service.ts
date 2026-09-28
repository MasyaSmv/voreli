import { extname } from "node:path";

import { Injectable } from "@nestjs/common";
import type { UploadPurpose } from "@prisma/client";

import { UnsupportedUploadTypeError, UploadTooLargeError } from "./errors/upload-errors.js";

interface AllowedType {
  readonly mime: string;
  readonly extensions: readonly string[];
  readonly inlineImage: boolean;
}

const ALLOWED_TYPES: readonly AllowedType[] = [
  { mime: "image/jpeg", extensions: [".jpg", ".jpeg"], inlineImage: true },
  { mime: "image/png", extensions: [".png"], inlineImage: true },
  { mime: "image/webp", extensions: [".webp"], inlineImage: true },
  { mime: "image/gif", extensions: [".gif"], inlineImage: true },
  { mime: "application/pdf", extensions: [".pdf"], inlineImage: false },
  { mime: "text/plain", extensions: [".txt"], inlineImage: false },
  { mime: "application/zip", extensions: [".zip"], inlineImage: false },
];

export const UPLOAD_LIMITS = {
  attachmentBytes: 25 * 1024 * 1024,
  avatarBytes: 5 * 1024 * 1024,
  activeReservations: 20,
  reservationMilliseconds: 15 * 60 * 1_000,
  retentionMilliseconds: 24 * 60 * 60 * 1_000,
  stagingGraceMilliseconds: 24 * 60 * 60 * 1_000,
  imagePixels: 40_000_000,
  imageProcessingSeconds: 5,
} as const;

@Injectable()
export class UploadPolicyService {
  validateReservation(
    fileName: string,
    declaredMime: string,
    byteSize: number,
    purpose: UploadPurpose,
  ): void {
    const allowed = this.typeFor(fileName, declaredMime);
    const limit = purpose === "AVATAR" ? UPLOAD_LIMITS.avatarBytes : UPLOAD_LIMITS.attachmentBytes;

    if (!allowed || (purpose === "AVATAR" && !allowed.inlineImage)) {
      throw new UnsupportedUploadTypeError(fileName, declaredMime, purpose.toLowerCase());
    }

    if (byteSize > limit) {
      throw new UploadTooLargeError(byteSize, limit);
    }
  }

  validateDetected(fileName: string, declaredMime: string, detectedMime: string): void {
    const allowed = this.typeFor(fileName, declaredMime);

    if (!allowed || allowed.mime !== detectedMime) {
      throw new UnsupportedUploadTypeError(fileName, detectedMime, "detected content");
    }
  }

  isImage(mime: string): boolean {
    return ALLOWED_TYPES.some((entry) => entry.mime === mime && entry.inlineImage);
  }

  private typeFor(fileName: string, mime: string): AllowedType | undefined {
    const extension = extname(fileName).toLowerCase();
    return ALLOWED_TYPES.find(
      (entry) => entry.mime === mime && entry.extensions.includes(extension),
    );
  }
}
