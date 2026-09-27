import { Inject, Injectable } from "@nestjs/common";
import type { Upload } from "@prisma/client";

import { CLOCK, type Clock } from "../../common/services/clock.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../../infra/storage/object-storage.js";
import { UploadLifecycleService } from "./upload-lifecycle.service.js";
import { uploadObjectKeys } from "./upload-object-keys.js";
import { UPLOAD_LIMITS } from "./upload-policy.service.js";

@Injectable()
export class UploadObjectCleanupService {
  constructor(
    private readonly lifecycle: UploadLifecycleService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async clean(upload: Upload): Promise<boolean> {
    const keys = uploadObjectKeys(upload);
    let cleaned = false;
    if ((upload.status === "EXPIRED" || upload.status === "REJECTED") && !upload.objectDeletedAt) {
      // State became terminal before S3 I/O. A crash or partial DELETE is retried next cycle.
      await Promise.all([
        this.storage.delete(keys.original),
        this.storage.delete(keys.thumbnail),
        this.storage.delete(keys.staging),
      ]);
      await this.lifecycle.markObjectDeleted(upload.id);
      cleaned = true;
    }
    if (
      ["READY", "EXPIRED", "REJECTED"].includes(upload.status) &&
      !upload.stagingDeletedAt &&
      this.clock.now().getTime() >=
        upload.expiresAt.getTime() + UPLOAD_LIMITS.stagingGraceMilliseconds
    ) {
      // A signed POST remains reusable after complete. Final sweeping waits for its
      // expiry plus a grace period for requests that started while the signature was valid.
      await this.storage.delete(keys.staging);
      await this.lifecycle.markStagingDeleted(upload.id);
      cleaned = true;
    }
    return cleaned;
  }
}
