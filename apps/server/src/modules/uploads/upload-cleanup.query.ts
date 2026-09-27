import { Inject, Injectable } from "@nestjs/common";
import type { Prisma, Upload } from "@prisma/client";

import { CLOCK, type Clock } from "../../common/services/clock.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import { UPLOAD_LIMITS } from "./upload-policy.service.js";

@Injectable()
export class UploadCleanupQuery {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  due(limit: number): Promise<Upload[]> {
    const now = this.clock.now();
    const retainedUntil = new Date(now.getTime() - UPLOAD_LIMITS.retentionMilliseconds);
    const signingFinished = new Date(now.getTime() - UPLOAD_LIMITS.stagingGraceMilliseconds);
    const unreferenced: Prisma.UploadWhereInput = {
      avatarForUser: { is: null },
      attachment: { is: null },
      OR: [{ unreferencedAt: null }, { unreferencedAt: { lte: retainedUntil } }],
    };
    return this.prisma.db.upload.findMany({
      where: {
        cleanupRetryAt: { lte: now },
        OR: [
          { status: { in: ["RESERVED", "UPLOADED"] }, expiresAt: { lte: now } },
          { status: { in: ["EXPIRED", "REJECTED"] }, objectDeletedAt: null },
          {
            status: "READY",
            OR: [
              unreferenced,
              {
                avatarForUser: { is: null },
                attachment: { is: { message: { deletedAt: { lte: retainedUntil } } } },
              },
            ],
          },
          {
            status: { in: ["READY", "EXPIRED", "REJECTED"] },
            stagingDeletedAt: null,
            expiresAt: { lte: signingFinished },
          },
        ],
      },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: limit,
    });
  }
}
