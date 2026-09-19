import { Injectable } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { AuthenticatedResponse } from "@voreli/shared";
import type { Request, Response } from "express";

import { RefreshCookie } from "./refresh-cookie.js";
import { SessionIssuer } from "./session-issuer.service.js";
import { SessionOriginResolver } from "./session-origin.resolver.js";

/** Completes browser login and registration with the shared access/refresh response. */
@Injectable()
export class BrowserSessionResponder {
  constructor(
    private readonly issuer: SessionIssuer,
    private readonly cookie: RefreshCookie,
    private readonly origins: SessionOriginResolver,
  ) {}

  async respondFor(
    user: User,
    request: Request,
    response: Response,
  ): Promise<AuthenticatedResponse> {
    const issued = await this.issuer.issueFor(user, this.origins.resolve(request));

    this.cookie.write(response, issued.refresh.token, issued.refresh.expiresAt);

    return issued.body;
  }
}
