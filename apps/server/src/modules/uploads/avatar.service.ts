import { Injectable } from "@nestjs/common";
import type { PublicUser } from "@voreli/shared";

import { PrismaService } from "../../infra/database/prisma.service.js";
import { UserPresenter } from "../auth/user-presenter.js";
import { UploadNotReadyError } from "./errors/upload-errors.js";
import { UploadLifecycleService } from "./upload-lifecycle.service.js";

@Injectable()
export class AvatarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: UploadLifecycleService,
    private readonly users: UserPresenter,
  ) {}

  async set(userId: string, uploadId: string): Promise<PublicUser> {
    return this.prisma.runInTransaction(async () => {
      // Serialize replacements before locking uploads, including concurrent A -> B -> A.
      await this.prisma.db.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
      const previous = await this.prisma.db.user.findUniqueOrThrow({
        where: { id: userId },
        select: { avatarUploadId: true },
      });
      const user = await this.lifecycle.withReady(uploadId, userId, "AVATAR", async (upload) => {
        if (!upload.thumbnailKey) throw new UploadNotReadyError(uploadId);
        return this.prisma.db.user.update({
          where: { id: userId },
          data: { avatarUploadId: uploadId, avatarUrl: null },
        });
      });
      if (previous.avatarUploadId && previous.avatarUploadId !== uploadId) {
        await this.lifecycle.markUnreferenced(previous.avatarUploadId);
      }
      return this.users.toPublic(user);
    });
  }
}
