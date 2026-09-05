import { Inject, Injectable, Logger } from "@nestjs/common";
import type { User } from "@prisma/client";

import { ID_GENERATOR, type IdGenerator } from "../../common/services/id-generator.js";
import { PASSWORD_HASHER, type PasswordHasher } from "../../common/services/password-hasher.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import { UsernameTakenError } from "./errors/auth-errors.js";
import { InviteRedemptionService } from "./invite-redemption.service.js";

export interface RegistrationInput {
  readonly inviteCode: string;
  readonly username: string;
  readonly password: string;
  readonly displayName?: string | undefined;
}

/**
 * Registration in one step: an invite link, a name and a password. No email, no phone, no
 * confirmation round trip — the product requirement is minimum friction, and every extra
 * field is a person who does not finish.
 */
@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invites: InviteRedemptionService,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async register(input: RegistrationInput): Promise<User> {
    const username = input.username.toLowerCase();

    // Checked before hashing: argon2 is deliberately slow, and there is no reason to spend
    // that on a request already doomed by a taken name.
    await this.invites.assertUsable(input.inviteCode);
    await this.assertUsernameFree(username);

    const passwordHash = await this.passwords.hash(input.password);

    return this.prisma.runInTransaction(async () => {
      const user = await this.prisma.db.user.create({
        data: {
          id: this.ids.generate(),
          username,
          displayName: input.displayName?.trim() || input.username,
          passwordHash,
        },
      });

      await this.invites.redeem(input.inviteCode, user.id);
      this.logger.log(`Registered user ${user.id} via invite ${input.inviteCode}`);

      return user;
    });
  }

  private async assertUsernameFree(username: string): Promise<void> {
    const existing = await this.prisma.db.user.findUnique({
      where: { username },
      select: { id: true },
    });

    if (existing) {
      throw new UsernameTakenError(username);
    }
  }
}
