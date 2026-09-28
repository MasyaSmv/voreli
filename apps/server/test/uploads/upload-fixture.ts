import { createHash } from "node:crypto";

import { createId } from "@paralleldrive/cuid2";
import type { Upload } from "@prisma/client";
import sharp from "sharp";

import { OBJECT_STORAGE, type ObjectStorage } from "../../src/infra/storage/object-storage.js";
import { UploadLifecycleService } from "../../src/modules/uploads/upload-lifecycle.service.js";
import { uploadObjectKeys } from "../../src/modules/uploads/upload-object-keys.js";
import { UploadProcessorService } from "../../src/modules/uploads/upload-processor.service.js";
import { UploadService } from "../../src/modules/uploads/upload.service.js";
import type { TestApp } from "../support/test-app.js";

/** Real image processing and object storage; only fixture timestamps are written directly. */
export class UploadFixture {
  private readonly keys = new Set<string>();
  private readonly storage: ObjectStorage;

  constructor(
    private readonly harness: TestApp,
    readonly ownerId: string,
    readonly serverId: string,
  ) {
    this.storage = harness.app.get<ObjectStorage>(OBJECT_STORAGE);
  }

  async ready(purpose: "attachment" | "avatar" = "attachment"): Promise<Upload> {
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } })
      .png()
      .toBuffer();
    const service = this.harness.app.get(UploadService);
    const reserved = await service.reserve(this.ownerId, {
      fileName: "image.png",
      byteSize: bytes.length,
      declaredMime: "image/png",
      purpose,
    });
    const upload = await this.row(reserved.uploadId);
    for (const key of Object.values(uploadObjectKeys(upload))) this.keys.add(key);
    await this.storage.write(upload.objectKey, bytes, "image/png");
    await service.complete(this.ownerId, upload.id, {
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    });
    await this.harness.app.get(UploadProcessorService).process(upload.id);
    return this.row(upload.id);
  }

  row(uploadId: string): Promise<Upload> {
    return this.harness.prisma.db.upload.findUniqueOrThrow({ where: { id: uploadId } });
  }

  async age(uploadId: string): Promise<void> {
    await this.harness.prisma.db.upload.update({
      where: { id: uploadId },
      data: { unreferencedAt: new Date(0), expiresAt: new Date(0) },
    });
  }

  async attach(upload: Upload): Promise<string> {
    const channelId = createId();
    const messageId = createId();
    await this.harness.prisma.db.channel.create({
      data: { id: channelId, serverId: this.serverId, name: "files", type: "TEXT" },
    });
    await this.harness.prisma.db.message.create({
      data: { id: messageId, authorId: this.ownerId, channelId, content: Buffer.from("file") },
    });
    await this.harness.app
      .get(UploadLifecycleService)
      .withReady(upload.id, this.ownerId, "ATTACHMENT", async () => {
        await this.harness.prisma.db.attachment.create({
          data: { id: createId(), uploadId: upload.id, messageId, position: 0 },
        });
      });
    return messageId;
  }

  async dispose(): Promise<void> {
    for (const key of this.keys) await this.storage.delete(key);
    this.keys.clear();
  }
}
