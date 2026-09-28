import { Inject, Injectable, Logger } from "@nestjs/common";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../common/events/domain-event-bus.js";

import { OBJECT_STORAGE, type ObjectStorage } from "../../infra/storage/object-storage.js";
import { UploadRejectedError } from "./errors/upload-errors.js";
import { UploadLifecycleService } from "./upload-lifecycle.service.js";
import { UploadInspectorService } from "./upload-inspector.service.js";
import { uploadObjectKeys } from "./upload-object-keys.js";
import { UploadObjectCleanupService } from "./upload-object-cleanup.service.js";

@Injectable()
export class UploadProcessorService {
  private readonly logger = new Logger(UploadProcessorService.name);

  constructor(
    private readonly lifecycle: UploadLifecycleService,
    private readonly inspector: UploadInspectorService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly cleanup: UploadObjectCleanupService,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async process(uploadId: string): Promise<void> {
    const upload = await this.lifecycle.beginProcessing(uploadId);

    if (!upload) {
      return;
    }

    try {
      const inspected = await this.inspector.inspect(upload);
      const keys = uploadObjectKeys(upload);
      const finalKey = keys.original;
      const thumbnailKey = inspected.thumbnail ? keys.thumbnail : null;

      await this.storage.write(finalKey, inspected.bytes, inspected.detectedMime);

      if (inspected.thumbnail && thumbnailKey) {
        await this.storage.write(thumbnailKey, inspected.thumbnail, "image/webp");
      }

      const ready = await this.lifecycle.markReady(upload.id, {
        objectKey: finalKey,
        detectedMime: inspected.detectedMime,
        checksumSha256: inspected.checksum,
        width: inspected.width,
        height: inspected.height,
        thumbnailKey,
      });

      if (ready) {
        await this.events.publish("upload.ready", { uploadId: ready.id, ownerId: ready.ownerId });
      }

      try {
        await this.storage.delete(upload.objectKey);
      } catch (error: unknown) {
        this.logger.error(
          `Failed to delete staging object after upload became ready ${JSON.stringify({ uploadId, objectKey: upload.objectKey })}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    } catch (error: unknown) {
      if (error instanceof UploadRejectedError) {
        await this.lifecycle.markRejected(upload.id, error.rejectionCode);
        try {
          await this.cleanup.clean(await this.lifecycle.owned(upload.id, upload.ownerId));
        } catch (cleanupError: unknown) {
          this.logger.error(
            { error: cleanupError, operation: "upload.reject.cleanup", uploadId },
            cleanupError instanceof Error ? cleanupError.stack : undefined,
          );
        }
        this.logger.warn(
          `Upload rejected ${JSON.stringify({ errorCode: error.errorCode, ...error.context() })}`,
        );
        return;
      }

      this.logger.error(
        `Upload processing failed ${JSON.stringify({ uploadId })}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
