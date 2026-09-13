import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import type { ContactSettingsView } from "@voreli/shared";

import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { type AuthContext, CurrentAuth } from "../auth/current-user.decorator.js";
import { ContactSettingsService } from "./contact-settings.service.js";
import { UpdateContactSettingsDto } from "./dto/relationship.dto.js";

@Controller("users/me/contact-settings")
@UseGuards(AccessTokenGuard)
export class ContactSettingsController {
  constructor(private readonly settings: ContactSettingsService) {}

  @Get()
  get(@CurrentAuth() auth: AuthContext): Promise<ContactSettingsView> {
    return this.settings.get(auth.user.id);
  }

  @Patch()
  update(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: UpdateContactSettingsDto,
  ): Promise<ContactSettingsView> {
    return this.settings.update(auth.user.id, dto);
  }
}
