import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  UseGuards,
} from "@nestjs/common";
import { type CategoryView, Permission } from "@voreli/shared";

import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { PermissionGuard } from "../permissions/permission.guard.js";
import { RequirePermission } from "../permissions/require-permission.decorator.js";
import { ChannelManagementService } from "./channel-management.service.js";
import { UpdateCategoryDto } from "./dto/server.dto.js";
import { ServerPresenter } from "./server-presenter.js";

@Controller("categories")
@UseGuards(AccessTokenGuard, PermissionGuard)
export class CategoriesController {
  constructor(
    private readonly channels: ChannelManagementService,
    private readonly presenter: ServerPresenter,
  ) {}

  @Patch(":categoryId")
  @RequirePermission(Permission.ManageChannels)
  async update(
    @Param("categoryId") categoryId: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryView> {
    return this.presenter.category(
      await this.channels.renameCategory(categoryId, dto.name, dto.position),
    );
  }

  @Delete(":categoryId")
  @RequirePermission(Permission.ManageChannels)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("categoryId") categoryId: string): Promise<void> {
    await this.channels.deleteCategory(categoryId);
  }
}
