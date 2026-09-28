import { Inject, Injectable } from "@nestjs/common";

import { OBJECT_STORAGE, type ObjectStorage } from "../../infra/storage/object-storage.js";
import type { AccessibleAttachment } from "./attachment-access.policy.js";

@Injectable()
export class AttachmentDownloadService {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  redirectUrl(attachment: AccessibleAttachment): Promise<string> {
    // Originals are downloads, including images. Only re-encoded previews may be inline.
    return this.storage.presignDownload(
      attachment.objectKey,
      attachment.originalName,
      "application/octet-stream",
      300,
    );
  }
}
