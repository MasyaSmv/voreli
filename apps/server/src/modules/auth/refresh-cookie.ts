import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { REFRESH_COOKIE } from "@voreli/shared";
import type { CookieOptions, Request, Response } from "express";

import type { EnvironmentVariables } from "../../config/env.validation.js";

/**
 * One place that knows how the refresh cookie is written and read.
 *
 * httpOnly so that no script on the page can read it, SameSite=Lax so it is not sent along
 * with cross-site requests, and Secure wherever TLS exists. Scoped to the refresh and
 * logout paths: no other endpoint has any use for it, and a cookie that is not sent cannot
 * be stolen in transit.
 */
@Injectable()
export class RefreshCookie {
  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

  write(response: Response, token: string, expiresAt: Date): void {
    response.cookie(REFRESH_COOKIE, token, { ...this.options(), expires: expiresAt });
  }

  clear(response: Response): void {
    response.clearCookie(REFRESH_COOKIE, this.options());
  }

  read(request: Request): string | null {
    const cookies: unknown = (request as { cookies?: unknown }).cookies;

    if (typeof cookies !== "object" || cookies === null) {
      return null;
    }

    const value = (cookies as Record<string, unknown>)[REFRESH_COOKIE];

    return typeof value === "string" && value.length > 0 ? value : null;
  }

  private options(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get("COOKIE_SECURE", { infer: true }),
      sameSite: "lax",
      path: "/auth",
    };
  }
}
