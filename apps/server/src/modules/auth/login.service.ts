import { Inject, Injectable, Logger } from "@nestjs/common";
import type { User } from "@prisma/client";

import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from "../../common/services/password-hasher.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import { InvalidCredentialsError } from "./errors/auth-errors.js";

@Injectable()
export class LoginService {
  private readonly logger = new Logger(LoginService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
  ) {}

  async authenticate(username: string, password: string): Promise<User> {
    const user = await this.prisma.db.user.findUnique({
      where: { username: username.toLowerCase() },
    });

    if (!user) {
      // Still verify against a throwaway hash: returning early here would make a missing
      // user answer measurably faster than a wrong password, which is a user directory.
      await this.passwords.verify(DUMMY_HASH, password);
      throw new InvalidCredentialsError();
    }

    if (!(await this.passwords.verify(user.passwordHash, password))) {
      this.logger.warn(`Failed login attempt for user ${user.id}`);
      throw new InvalidCredentialsError();
    }

    return user;
  }
}

/** argon2id hash of a random string nobody knows; exists only to burn the same time. */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZS1zYWx0LXZhbHVl$8Kx0rMLDIzOFV0M2iMPRGVQEXjXQ0yEJqz9fZ0vXbXo";
