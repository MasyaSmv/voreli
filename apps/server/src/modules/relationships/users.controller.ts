import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { ContactLookupResponse } from "@voreli/shared";

import { RATE_LIMITS } from "../../common/rate-limit/rate-limit.module.js";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { type AuthContext, CurrentAuth } from "../auth/current-user.decorator.js";
import { UsernameQueryDto } from "./dto/relationship.dto.js";
import { UserLookupService } from "./user-lookup.service.js";

@Controller("users")
@UseGuards(AccessTokenGuard)
export class UsersController {
  constructor(private readonly lookup: UserLookupService) {}

  @Get("lookup")
  @Throttle({ default: RATE_LIMITS.userLookup })
  exact(
    @CurrentAuth() auth: AuthContext,
    @Query() query: UsernameQueryDto,
  ): Promise<ContactLookupResponse> {
    return this.lookup.exact(auth.user.id, query.username);
  }
}
