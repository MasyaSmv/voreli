import { Inject, Injectable } from "@nestjs/common";
import { OBJECT_STORAGE, type ObjectStorage } from "../../infra/storage/object-storage.js";
import { UploadLifecycleService } from "./upload-lifecycle.service.js";
import { UploadNotReadyError } from "./errors/upload-errors.js";

@Injectable()
export class UploadPreviewService {
  constructor(
    private readonly uploads: UploadLifecycleService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}
  async url(uploadId: string, ownerId: string): Promise<string> {
    const upload = await this.uploads.owned(uploadId, ownerId);
    if (upload.status !== "READY" || !upload.thumbnailKey) throw new UploadNotReadyError(uploadId);
    return this.storage.presignDownload(upload.thumbnailKey, "preview.webp", "image/webp", 300);
  }
}
