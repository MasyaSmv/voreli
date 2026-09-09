import { Injectable } from "@nestjs/common";
import type { ContactLookupResponse } from "@voreli/shared";

import { normalizeUsername } from "../../common/identity/username.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import { ContactPolicyService } from "./contact-policy.service.js";

@Injectable()
export class UserLookupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: ContactPolicyService,
  ) {}

  async exact(requesterId: string, usernameInput: string): Promise<ContactLookupResponse> {
    const username = normalizeUsername(usernameInput);
    const user = await this.prisma.db.user.findUnique({ where: { username } });

    if (!user || user.id === requesterId || (await this.policy.hasBlock(requesterId, user.id))) {
      return { user: null };
    }

    return {
      user: this.policy.toProfile(user, await this.policy.capabilities(requesterId, user.id)),
    };
  }
}
