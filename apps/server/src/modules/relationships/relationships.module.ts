import { Module } from "@nestjs/common";

import { RateLimitModule } from "../../common/rate-limit/rate-limit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { ContactPolicyService } from "./contact-policy.service.js";
import { ContactSettingsController } from "./contact-settings.controller.js";
import { ContactSettingsService } from "./contact-settings.service.js";
import { DirectConversationService } from "./direct-conversation.service.js";
import { FriendRequestService } from "./friend-request.service.js";
import { RelationshipQueryService } from "./relationship-query.service.js";
import { RelationshipService } from "./relationship.service.js";
import { RelationshipsController } from "./relationships.controller.js";
import { UserLookupService } from "./user-lookup.service.js";
import { UsersController } from "./users.controller.js";

@Module({
  imports: [AuthModule, RateLimitModule],
  controllers: [ContactSettingsController, RelationshipsController, UsersController],
  providers: [
    ContactPolicyService,
    ContactSettingsService,
    DirectConversationService,
    FriendRequestService,
    RelationshipQueryService,
    RelationshipService,
    UserLookupService,
  ],
  exports: [ContactPolicyService, DirectConversationService],
})
export class RelationshipsModule {}
