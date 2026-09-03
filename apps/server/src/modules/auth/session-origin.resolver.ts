import { Injectable } from "@nestjs/common";
import type { Request } from "express";

import type { SessionOrigin } from "./refresh-token.service.js";

/**
 * Extracts what a session should remember about the device that opened it, so the user can
 * recognise their own sessions in the list and spot one that is not theirs.
 */
@Injectable()
export class SessionOriginResolver {
  resolve(request: Request): SessionOrigin {
    const userAgent = request.headers["user-agent"];

    return {
      userAgent: typeof userAgent === "string" ? userAgent.slice(0, 256) : null,
      ip: request.ip ?? null,
    };
  }
}
