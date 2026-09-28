import { Injectable } from "@nestjs/common";
import type { Upload } from "@prisma/client";
import type { UploadView } from "@voreli/shared";

@Injectable()
export class UploadPresenter {
  toView(upload: Upload): UploadView {
    return {
      id: upload.id,
      purpose: upload.purpose.toLowerCase() as UploadView["purpose"],
      status: upload.status.toLowerCase() as UploadView["status"],
      originalName: upload.originalName,
      declaredMime: upload.declaredMime,
      detectedMime: upload.detectedMime,
      byteSize: upload.byteSize,
      checksumSha256: upload.checksumSha256,
      width: upload.width,
      height: upload.height,
      rejectionCode: upload.rejectionCode,
      expiresAt: upload.expiresAt.toISOString(),
      completedAt: upload.completedAt?.toISOString() ?? null,
    };
  }
}
