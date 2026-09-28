import { Body, Controller, Get, Param, Post, Put, Res, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { PublicUser, ReservedUploadResponse, UploadView } from "@voreli/shared";
import type { Response } from "express";

import { RATE_LIMITS } from "../../common/rate-limit/rate-limit.module.js";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { type AuthContext, CurrentAuth } from "../auth/current-user.decorator.js";
import { AvatarContentService } from "./avatar-content.service.js";
import { AvatarService } from "./avatar.service.js";
import { CompleteUploadDto, ReserveUploadDto, SetAvatarDto } from "./dto/upload.dto.js";
import { UploadService } from "./upload.service.js";

@Controller("uploads")
@UseGuards(AccessTokenGuard)
export class UploadsController {
  constructor(private readonly uploads: UploadService) {}

  @Post("reserve")
  @Throttle({ default: RATE_LIMITS.uploadReserve })
  reserve(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: ReserveUploadDto,
  ): Promise<ReservedUploadResponse> {
    return this.uploads.reserve(auth.user.id, dto);
  }

  @Post(":uploadId/complete")
  complete(
    @CurrentAuth() auth: AuthContext,
    @Param("uploadId") uploadId: string,
    @Body() dto: CompleteUploadDto,
  ): Promise<UploadView> {
    return this.uploads.complete(auth.user.id, uploadId, dto);
  }

  @Get(":uploadId")
  get(@CurrentAuth() auth: AuthContext, @Param("uploadId") uploadId: string): Promise<UploadView> {
    return this.uploads.get(auth.user.id, uploadId);
  }
}

@Controller("users/me/avatar")
@UseGuards(AccessTokenGuard)
export class AvatarController {
  constructor(private readonly avatars: AvatarService) {}

  @Put()
  set(@CurrentAuth() auth: AuthContext, @Body() dto: SetAvatarDto): Promise<PublicUser> {
    return this.avatars.set(auth.user.id, dto.uploadId);
  }
}

@Controller("uploads")
export class AvatarContentController {
  constructor(private readonly avatars: AvatarContentService) {}

  @Get(":uploadId/content")
  async content(@Param("uploadId") uploadId: string, @Res() response: Response): Promise<void> {
    response.redirect(302, await this.avatars.redirectUrl(uploadId));
  }
}
