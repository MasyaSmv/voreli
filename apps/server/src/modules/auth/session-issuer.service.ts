import { Injectable } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { AuthenticatedResponse } from "@voreli/shared";

import { AccessTokenService } from "./access-token.service.js";
import {
  type IssuedRefreshToken,
  RefreshTokenService,
  type SessionOrigin,
} from "./refresh-token.service.js";
import { UserPresenter } from "./user-presenter.js";

export interface IssuedSession {
  readonly body: AuthenticatedResponse;
  readonly refresh: IssuedRefreshToken;
}

/**
 * Turns an authenticated user into the pair of tokens the client needs. Registration and
 * login both end here, which is why it is a service and not a private method of either.
 */
@Injectable()
export class SessionIssuer {
  constructor(
    private readonly refreshTokens: RefreshTokenService,
    private readonly accessTokens: AccessTokenService,
    private readonly presenter: UserPresenter,
  ) {}

  async issueFor(user: User, origin: SessionOrigin): Promise<IssuedSession> {
    const refresh = await this.refreshTokens.issue(user.id, origin);
    const access = await this.accessTokens.mint(user.id, refresh.sessionId);

    return {
      body: {
        user: this.presenter.toPublic(user),
        accessToken: access.token,
        expiresIn: access.expiresIn,
      },
      refresh,
    };
  }
}
