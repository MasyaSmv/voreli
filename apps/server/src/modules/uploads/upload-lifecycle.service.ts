import { Inject, Injectable } from "@nestjs/common";
import type { Upload, UploadPurpose } from "@prisma/client";

import { CLOCK, type Clock } from "../../common/services/clock.js";
import { ID_GENERATOR, type IdGenerator } from "../../common/services/id-generator.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import {
  TooManyActiveUploadsError,
  UploadNotFoundError,
  UploadNotOwnedError,
  UploadNotReadyError,
} from "./errors/upload-errors.js";
import { UPLOAD_LIMITS } from "./upload-policy.service.js";
import { uploadObjectKeys } from "./upload-object-keys.js";

export const UPLOAD_OUTBOX_EVENT = "attachment.uploaded";

interface CreateReservation {
  readonly ownerId: string;
  readonly purpose: UploadPurpose;
  readonly originalName: string;
  readonly declaredMime: string;
  readonly byteSize: number;
}

interface ReadyMetadata {
  readonly objectKey: string;
  readonly detectedMime: string;
  readonly checksumSha256: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly thumbnailKey: string | null;
}

@Injectable()
export class UploadLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  reserve(input: CreateReservation): Promise<Upload> {
    return this.prisma.runInTransaction(async () => {
      await this.prisma.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.ownerId}))`;

      const active = await this.prisma.db.upload.count({
        where: {
          ownerId: input.ownerId,
          status: { in: ["RESERVED", "UPLOADED", "PROCESSING"] },
        },
      });

      if (active >= UPLOAD_LIMITS.activeReservations) {
        throw new TooManyActiveUploadsError(input.ownerId);
      }

      const id = this.ids.generate();
      const expiresAt = new Date(
        this.clock.now().getTime() + UPLOAD_LIMITS.reservationMilliseconds,
      );

      return this.prisma.db.upload.create({
        data: {
          id,
          ownerId: input.ownerId,
          purpose: input.purpose,
          status: "RESERVED",
          originalName: input.originalName,
          declaredMime: input.declaredMime,
          byteSize: input.byteSize,
          objectKey: uploadObjectKeys({ ...input, id }).staging,
          expiresAt,
        },
      });
    });
  }

  async removeUnpublishedReservation(uploadId: string): Promise<void> {
    await this.prisma.db.upload.deleteMany({ where: { id: uploadId, status: "RESERVED" } });
  }

  async owned(uploadId: string, ownerId: string): Promise<Upload> {
    const upload = await this.prisma.db.upload.findUnique({ where: { id: uploadId } });

    if (!upload) {
      throw new UploadNotFoundError(uploadId);
    }

    if (upload.ownerId !== ownerId) {
      throw new UploadNotOwnedError(uploadId);
    }

    return upload;
  }

  async expire(uploadId: string): Promise<Upload | null> {
    const changed = await this.prisma.db.upload.updateMany({
      where: { id: uploadId, status: { in: ["RESERVED", "UPLOADED"] } },
      data: { status: "EXPIRED" },
    });

    if (changed.count === 0) {
      return null;
    }

    const upload = await this.prisma.db.upload.findUnique({ where: { id: uploadId } });

    if (!upload) {
      throw new UploadNotFoundError(uploadId);
    }

    return upload;
  }

  async markObjectDeleted(uploadId: string): Promise<void> {
    await this.prisma.db.upload.updateMany({
      where: { id: uploadId, status: { in: ["EXPIRED", "REJECTED"] } },
      data: { objectDeletedAt: this.clock.now() },
    });
  }

  complete(uploadId: string, ownerId: string, checksumSha256: string): Promise<Upload> {
    return this.prisma.runInTransaction(async () => {
      await this.lock(uploadId);
      const upload = await this.owned(uploadId, ownerId);

      if (upload.status !== "RESERVED") {
        return upload;
      }

      // HEAD and waiting for a competing transaction can outlive the reservation.
      if (upload.expiresAt <= this.clock.now()) {
        return this.prisma.db.upload.update({
          where: { id: uploadId },
          data: { status: "EXPIRED" },
        });
      }

      const changed = await this.prisma.db.upload.updateMany({
        where: { id: uploadId, ownerId, status: "RESERVED" },
        data: { status: "UPLOADED", checksumSha256 },
      });

      if (changed.count === 0) {
        return this.owned(uploadId, ownerId);
      }

      await this.prisma.db.outboxEvent.create({
        data: {
          id: this.ids.generate(),
          type: UPLOAD_OUTBOX_EVENT,
          aggregateId: uploadId,
          payload: { uploadId },
        },
      });

      return this.owned(uploadId, ownerId);
    });
  }

  async beginProcessing(uploadId: string): Promise<Upload | null> {
    await this.prisma.db.upload.updateMany({
      where: { id: uploadId, status: "UPLOADED" },
      data: { status: "PROCESSING" },
    });
    const upload = await this.prisma.db.upload.findUnique({ where: { id: uploadId } });

    return upload?.status === "PROCESSING" ? upload : null;
  }

  async markReady(uploadId: string, metadata: ReadyMetadata): Promise<Upload | null> {
    const changed = await this.prisma.db.upload.updateMany({
      where: { id: uploadId, status: "PROCESSING" },
      data: {
        status: "READY",
        objectKey: metadata.objectKey,
        detectedMime: metadata.detectedMime,
        checksumSha256: metadata.checksumSha256,
        width: metadata.width,
        height: metadata.height,
        thumbnailKey: metadata.thumbnailKey,
        completedAt: this.clock.now(),
        objectDeletedAt: null,
        unreferencedAt: this.clock.now(),
        rejectionCode: null,
      },
    });

    return changed.count === 0
      ? null
      : this.prisma.db.upload.findUnique({ where: { id: uploadId } });
  }

  async markRejected(uploadId: string, rejectionCode: string): Promise<void> {
    await this.prisma.db.upload.updateMany({
      where: { id: uploadId, status: { in: ["UPLOADED", "PROCESSING"] } },
      data: {
        status: "REJECTED",
        rejectionCode,
        completedAt: this.clock.now(),
      },
    });
  }

  /** Binding and retirement take the same row lock; READY alone is not a lease. */
  withReady<T>(
    uploadId: string,
    ownerId: string,
    purpose: UploadPurpose,
    bind: (upload: Upload) => Promise<T>,
  ): Promise<T> {
    return this.prisma.runInTransaction(async () => {
      await this.lock(uploadId);
      const upload = await this.owned(uploadId, ownerId);
      if (upload.status !== "READY" || upload.purpose !== purpose)
        throw new UploadNotReadyError(uploadId);
      const result = await bind(upload);
      await this.prisma.db.upload.update({
        where: { id: uploadId },
        data: { unreferencedAt: null },
      });
      return result;
    });
  }

  async markUnreferenced(uploadId: string): Promise<void> {
    await this.prisma.db.upload.updateMany({
      where: {
        id: uploadId,
        status: "READY",
        avatarForUser: { is: null },
        attachment: { is: null },
      },
      data: { unreferencedAt: this.clock.now() },
    });
  }

  async markStagingDeleted(uploadId: string): Promise<void> {
    await this.prisma.db.upload.updateMany({
      where: {
        id: uploadId,
        status: { in: ["READY", "EXPIRED", "REJECTED"] },
        expiresAt: {
          lte: new Date(this.clock.now().getTime() - UPLOAD_LIMITS.stagingGraceMilliseconds),
        },
      },
      data: { stagingDeletedAt: this.clock.now() },
    });
  }

  async deferCleanup(uploadId: string, attempts: number): Promise<void> {
    const delay = Math.min(3_600_000, 60_000 * 2 ** Math.min(attempts, 6));
    await this.prisma.db.upload.updateMany({
      where: { id: uploadId },
      data: {
        cleanupAttempts: { increment: 1 },
        cleanupRetryAt: new Date(this.clock.now().getTime() + delay),
      },
    });
  }

  claimCleanup(uploadId: string): Promise<Upload | null> {
    return this.prisma.runInTransaction(async () => {
      await this.lock(uploadId);
      const upload = await this.prisma.db.upload.findUnique({
        where: { id: uploadId },
        include: {
          avatarForUser: { select: { id: true } },
          attachment: { select: { message: { select: { deletedAt: true } } } },
        },
      });
      if (!upload || upload.status === "PROCESSING") return null;
      const now = this.clock.now();
      if (upload.status === "READY") {
        if (
          upload.avatarForUser ||
          (upload.attachment && upload.attachment.message.deletedAt === null)
        )
          return upload;
        const unreferencedAt = upload.attachment?.message.deletedAt ?? upload.unreferencedAt;
        if (!unreferencedAt) {
          await this.markUnreferenced(uploadId);
          return upload;
        }
        if (now.getTime() - unreferencedAt.getTime() < UPLOAD_LIMITS.retentionMilliseconds)
          return upload;
      } else if (upload.status === "RESERVED" || upload.status === "UPLOADED") {
        if (upload.expiresAt > now) return null;
      } else {
        return upload;
      }
      return this.prisma.db.upload.update({
        where: { id: uploadId },
        data: { status: "EXPIRED", objectDeletedAt: null },
      });
    });
  }

  private async lock(uploadId: string): Promise<void> {
    await this.prisma.db.$queryRaw`SELECT "id" FROM "uploads" WHERE "id" = ${uploadId} FOR UPDATE`;
  }
}
