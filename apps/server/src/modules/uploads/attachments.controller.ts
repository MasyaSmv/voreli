import { Controller, Get, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";

import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { AttachmentAccessGuard, CurrentAttachment } from "./attachment-access.guard.js";
import type { AccessibleAttachment } from "./attachment-access.policy.js";
import { AttachmentDownloadService } from "./attachment-download.service.js";

@Controller("attachments")
@UseGuards(AccessTokenGuard, AttachmentAccessGuard)
export class AttachmentsController {
  constructor(private readonly downloads: AttachmentDownloadService) {}

  @Get(":attachmentId/preview")
  async preview(
    @CurrentAttachment() attachment: AccessibleAttachment,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ url: string }> {
    response.set("Cache-Control", "private, no-store");
    return { url: await this.downloads.previewUrl(attachment) };
  }

  @Get(":attachmentId/download-url")
  async downloadUrl(
    @CurrentAttachment() attachment: AccessibleAttachment,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ url: string }> {
    response.set("Cache-Control", "private, no-store");
    return { url: await this.downloads.redirectUrl(attachment) };
  }

  @Get(":attachmentId/download")
  async download(
    @CurrentAttachment() attachment: AccessibleAttachment,
    @Res() response: Response,
  ): Promise<void> {
    response.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    response.redirect(302, await this.downloads.redirectUrl(attachment));
  }
}
