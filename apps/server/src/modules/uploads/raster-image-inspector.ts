import { Inject, Injectable, Logger } from "@nestjs/common";

import { BOUNDED_PROCESS, type BoundedProcess } from "../../infra/process/bounded-process.js";
import { ProcessLimitError, ProcessUnavailableError } from "../../infra/process/process-errors.js";
import { UploadRejectedError } from "./errors/upload-errors.js";
import { UPLOAD_LIMITS } from "./upload-policy.service.js";

@Injectable()
export class RasterImageInspector {
  private readonly logger = new Logger(RasterImageInspector.name);

  constructor(@Inject(BOUNDED_PROCESS) private readonly processHost: BoundedProcess) {}

  async inspect(
    uploadId: string,
    bytes: Uint8Array,
  ): Promise<{
    width: number;
    height: number;
    thumbnail: Uint8Array;
  }> {
    try {
      const result = await this.processHost.run(
        new URL("./image-worker.mjs", import.meta.url),
        [
          String(UPLOAD_LIMITS.imagePixels),
          String(UPLOAD_LIMITS.imageProcessingSeconds),
          String(UPLOAD_LIMITS.attachmentBytes),
        ],
        bytes,
        {
          addressSpaceBytes: 1024 * 1024 * 1024,
          cpuSeconds: 10,
          wallMilliseconds: 10_000,
          outputBytes: 12 * 1024 * 1024,
        },
      );
      if (result.code === 2) {
        this.logger.warn({ errorCode: UploadRejectedError.CODE, uploadId, stderr: result.stderr });
        throw new UploadRejectedError(uploadId, "INVALID_IMAGE");
      }
      if (result.signal === "SIGKILL" || result.signal === "SIGXCPU") {
        throw new ProcessLimitError("deadline");
      }
      if (result.code !== 0 || result.stdout.length < 9) {
        throw new ProcessUnavailableError(
          `Image worker failed: code=${String(result.code)} signal=${String(result.signal)} ${result.stderr}`,
        );
      }
      const width = result.stdout.readUInt32BE(0);
      const height = result.stdout.readUInt32BE(4);
      if (!width || !height || width * height > UPLOAD_LIMITS.imagePixels) {
        throw new ProcessUnavailableError("Image worker returned invalid dimensions");
      }
      return { width, height, thumbnail: result.stdout.subarray(8) };
    } catch (error: unknown) {
      if (!(error instanceof ProcessLimitError)) throw error;
      this.logger.warn({
        error,
        errorCode: error.errorCode,
        operation: "upload.image.inspect",
        uploadId,
      });
      throw new UploadRejectedError(uploadId, "IMAGE_RESOURCE_LIMIT");
    }
  }
}
