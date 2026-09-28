import { createHash } from "node:crypto";

import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Upload } from "@prisma/client";
import { fileTypeFromBuffer } from "file-type";

import { OBJECT_STORAGE, type ObjectStorage } from "../../infra/storage/object-storage.js";
import { UnsupportedUploadTypeError, UploadRejectedError } from "./errors/upload-errors.js";
import { UploadPolicyService, UPLOAD_LIMITS } from "./upload-policy.service.js";
import { RasterImageInspector } from "./raster-image-inspector.js";

interface InspectedObject {
  readonly bytes: Uint8Array;
  readonly checksum: string;
  readonly detectedMime: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly thumbnail: Uint8Array | null;
}

@Injectable()
export class UploadInspectorService {
  private readonly logger = new Logger(UploadInspectorService.name);
  constructor(
    private readonly policy: UploadPolicyService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly images: RasterImageInspector,
  ) {}

  async inspect(upload: Upload): Promise<InspectedObject> {
    const source = await this.storage.read(upload.objectKey);
    const chunks: Buffer[] = [];
    const hash = createHash("sha256");
    let byteSize = 0;

    for await (const chunk of source) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      byteSize += bytes.byteLength;

      if (byteSize > upload.byteSize || byteSize > UPLOAD_LIMITS.attachmentBytes) {
        throw new UploadRejectedError(upload.id, "SIZE_MISMATCH");
      }

      hash.update(bytes);
      chunks.push(bytes);
    }

    if (byteSize !== upload.byteSize) {
      throw new UploadRejectedError(upload.id, "SIZE_MISMATCH");
    }

    const bytes = Buffer.concat(chunks);
    const checksum = hash.digest("hex");

    if (checksum !== upload.checksumSha256) {
      throw new UploadRejectedError(upload.id, "CHECKSUM_MISMATCH");
    }

    const detected = await this.detectType(upload.id, bytes);
    const detectedMime = detected?.mime ?? this.detectPlainText(upload, bytes);

    try {
      this.policy.validateDetected(upload.originalName, upload.declaredMime, detectedMime);
    } catch (error: unknown) {
      if (!(error instanceof UnsupportedUploadTypeError)) throw error;
      this.logger.warn({ error, errorCode: error.errorCode, uploadId: upload.id });
      throw new UploadRejectedError(upload.id, "TYPE_MISMATCH");
    }

    if (!this.policy.isImage(detectedMime)) {
      return { bytes, checksum, detectedMime, width: null, height: null, thumbnail: null };
    }

    const image = await this.images.inspect(upload.id, bytes);
    return { bytes, checksum, detectedMime, ...image };
  }

  private async detectType(uploadId: string, bytes: Uint8Array) {
    try {
      return await fileTypeFromBuffer(bytes);
    } catch (error: unknown) {
      const rejection = new UploadRejectedError(uploadId, "TYPE_MISMATCH");
      this.logger.warn({ error, errorCode: rejection.errorCode, uploadId });
      throw rejection;
    }
  }

  private detectPlainText(upload: Upload, bytes: Uint8Array): string {
    if (upload.declaredMime !== "text/plain") {
      return "application/octet-stream";
    }

    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return bytes.includes(0) ? "application/octet-stream" : "text/plain";
    } catch (error: unknown) {
      this.logger.warn({
        error,
        errorCode: UploadRejectedError.CODE,
        uploadId: upload.id,
        operation: "upload.text.decode",
      });
      return "application/octet-stream";
    }
  }
}
