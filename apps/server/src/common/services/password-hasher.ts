import { Injectable } from "@nestjs/common";
import argon2 from "argon2";

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  /** Constant-time where it matters; never leaks whether the hash or the password was wrong. */
  verify(hash: string, plain: string): Promise<boolean>;
}

export const PASSWORD_HASHER = Symbol("PASSWORD_HASHER");

/**
 * argon2id, as required by docs/decisions/2026-09-03-encryption-and-connectivity.md.
 * Not bcrypt: bcrypt silently truncates at 72 bytes and offers no memory hardness.
 */
@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  private readonly options = {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  } as const;

  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.options);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      // A malformed hash in the database must read as "wrong password", never as a crash
      // that tells the caller this account is special.
      return false;
    }
  }
}
