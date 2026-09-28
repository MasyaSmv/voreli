import { basename } from "node:path";

import { Inject, Injectable } from "@nestjs/common";
import type { UploadPurpose } from "@prisma/client";
import type { ReservedUploadResponse, UploadView } from "@voreli/shared";

import { CLOCK, type Clock } from "../../common/services/clock.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../../infra/storage/object-storage.js";
import type { CompleteUploadDto, ReserveUploadDto } from "./dto/upload.dto.js";
import {
  UploadExpiredError,
  UploadObjectMissingError,
  UploadSizeMismatchError,
} from "./errors/upload-errors.js";
import { UploadLifecycleService } from "./upload-lifecycle.service.js";
import { UploadPolicyService, UPLOAD_LIMITS } from "./upload-policy.service.js";
import { UploadPresenter } from "./upload.presenter.js";

@Injectable()
export class UploadService {
  constructor(
    private readonly lifecycle: UploadLifecycleService,
    private readonly policy: UploadPolicyService,
    private readonly presenter: UploadPresenter,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async reserve(ownerId: string, dto: ReserveUploadDto): Promise<ReservedUploadResponse> {
    const purpose: UploadPurpose = dto.purpose === "avatar" ? "AVATAR" : "ATTACHMENT";
    const originalName = this.safeName(dto.fileName);
    this.policy.validateReservation(originalName, dto.declaredMime, dto.byteSize, purpose);

    const upload = await this.lifecycle.reserve({
      ownerId,
      purpose,
      originalName,
      declaredMime: dto.declaredMime,
      byteSize: dto.byteSize,
    });

    try {
      const signed = await this.storage.reserveUpload(
        upload.objectKey,
        upload.declaredMime,
        upload.byteSize,
        Math.ceil(UPLOAD_LIMITS.reservationMilliseconds / 1_000),
      );

      return {
        uploadId: upload.id,
        upload: { method: "POST", url: signed.url, fields: signed.fields },
        expiresAt: upload.expiresAt.toISOString(),
      };
    } catch (error: unknown) {
      await this.lifecycle.removeUnpublishedReservation(upload.id);
      throw error;
    }
  }

  async complete(ownerId: string, uploadId: string, dto: CompleteUploadDto): Promise<UploadView> {
    const upload = await this.lifecycle.owned(uploadId, ownerId);

    if (upload.status !== "RESERVED") {
      return this.presenter.toView(upload);
    }

    if (upload.expiresAt <= this.clock.now()) {
      await this.lifecycle.expire(uploadId);
      throw new UploadExpiredError(uploadId);
    }

    const object = await this.storage.head(upload.objectKey);

    if (!object) {
      throw new UploadObjectMissingError(uploadId);
    }

    if (object.byteSize !== upload.byteSize) {
      throw new UploadSizeMismatchError(uploadId, upload.byteSize, object.byteSize);
    }

    const completed = await this.lifecycle.complete(uploadId, ownerId, dto.checksumSha256);
    if (completed.status === "EXPIRED") throw new UploadExpiredError(uploadId);
    return this.presenter.toView(completed);
  }

  async get(ownerId: string, uploadId: string): Promise<UploadView> {
    return this.presenter.toView(await this.lifecycle.owned(uploadId, ownerId));
  }

  private safeName(value: string): string {
    return basename(value)
      .split("")
      .map((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127 ? "_" : character;
      })
      .join("")
      .slice(0, 255);
  }
}
