import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../../infra/database/prisma.service.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../../infra/storage/object-storage.js";
import { UploadNotFoundError } from "./errors/upload-errors.js";

@Injectable()
export class AvatarContentService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async redirectUrl(uploadId: string): Promise<string> {
    const upload = await this.prisma.db.upload.findFirst({
      where: {
        id: uploadId,
        purpose: "AVATAR",
        status: "READY",
        avatarForUser: { isNot: null },
        thumbnailKey: { not: null },
      },
    });

    if (!upload?.thumbnailKey) {
      throw new UploadNotFoundError(uploadId);
    }

    return this.storage.presignDownload(upload.thumbnailKey, "avatar.webp", "image/webp", 5 * 60);
  }
}
