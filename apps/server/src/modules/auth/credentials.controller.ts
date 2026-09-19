import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AUTH_ROUTES, type AuthenticatedResponse } from "@voreli/shared";
import type { Request, Response } from "express";

import { RATE_LIMITS } from "../../common/rate-limit/rate-limit.module.js";
import { BrowserSessionResponder } from "./browser-session.responder.js";
import { LoginDto } from "./dto/login.dto.js";
import { RegisterDto } from "./dto/register.dto.js";
import { LoginService } from "./login.service.js";
import { RegistrationService } from "./registration.service.js";

@Controller()
export class CredentialsController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly login: LoginService,
    private readonly sessions: BrowserSessionResponder,
  ) {}

  @Post(AUTH_ROUTES.register)
  @Throttle({ default: RATE_LIMITS.register })
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthenticatedResponse> {
    const user = await this.registration.register(dto);

    return this.sessions.respondFor(user, request, response);
  }

  @Post(AUTH_ROUTES.login)
  @Throttle({ default: RATE_LIMITS.login })
  @HttpCode(HttpStatus.OK)
  async logIn(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthenticatedResponse> {
    const user = await this.login.authenticate(dto.username, dto.password);

    return this.sessions.respondFor(user, request, response);
  }
}
