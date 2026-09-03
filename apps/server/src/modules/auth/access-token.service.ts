import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { AccessTokenClaims } from "@voreli/shared";

import type { EnvironmentVariables } from "../../config/env.validation.js";

export interface MintedAccessToken {
  readonly token: string;
  readonly expiresIn: number;
}

/**
 * Mints short-lived access tokens. The session id travels inside the token so that
 * revoking a session also invalidates the tokens minted from it, without a database round
 * trip on every request.
 */
@Injectable()
export class AccessTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async mint(userId: string, sessionId: string): Promise<MintedAccessToken> {
    const expiresIn = this.config.get("ACCESS_TOKEN_TTL", { infer: true });
    const claims: AccessTokenClaims = { sub: userId, sid: sessionId };

    return { token: await this.jwt.signAsync(claims, { expiresIn }), expiresIn };
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    return this.jwt.verifyAsync<AccessTokenClaims>(token);
  }
}
