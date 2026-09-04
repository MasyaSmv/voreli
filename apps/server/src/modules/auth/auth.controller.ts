import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import {
  AUTH_ROUTES,
  type AuthenticatedResponse,
  type PublicUser,
  type RefreshedResponse,
  type SessionListResponse,
} from "@voreli/shared";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";

import { RATE_LIMITS } from "../../common/rate-limit/rate-limit.module.js";
import { AccessTokenGuard } from "./access-token.guard.js";
import { AccessTokenService } from "./access-token.service.js";
import { type AuthContext, CurrentAuth } from "./current-user.decorator.js";
import { LoginDto } from "./dto/login.dto.js";
import { RegisterDto } from "./dto/register.dto.js";
import { LoginService } from "./login.service.js";
import { RefreshCookie } from "./refresh-cookie.js";
import { RefreshTokenService } from "./refresh-token.service.js";
import { RegistrationService } from "./registration.service.js";
import { SessionIssuer } from "./session-issuer.service.js";
import { SessionListService } from "./session-list.service.js";
import { SessionOriginResolver } from "./session-origin.resolver.js";
import { UserPresenter } from "./user-presenter.js";

@Controller()
export class AuthController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly login: LoginService,
    private readonly issuer: SessionIssuer,
    private readonly refreshTokens: RefreshTokenService,
    private readonly accessTokens: AccessTokenService,
    private readonly sessions: SessionListService,
    private readonly cookie: RefreshCookie,
    private readonly origins: SessionOriginResolver,
    private readonly presenter: UserPresenter,
  ) {}

  @Post(AUTH_ROUTES.register)
  @Throttle({ default: RATE_LIMITS.register })
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthenticatedResponse> {
    const user = await this.registration.register(dto);

    return this.respondWithSession(user, request, response);
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

    return this.respondWithSession(user, request, response);
  }

  @Post(AUTH_ROUTES.refresh)
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RefreshedResponse> {
    const token = this.cookie.read(request);

    if (token === null) {
      throw new UnauthorizedException("Refresh token is missing");
    }

    const rotated = await this.refreshTokens.rotate(token, this.origins.resolve(request));
    const access = await this.accessTokens.mint(rotated.userId, rotated.sessionId);

    this.cookie.write(response, rotated.token, rotated.expiresAt);

    return { accessToken: access.token, expiresIn: access.expiresIn };
  }

  @Post(AUTH_ROUTES.logout)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logOut(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const token = this.cookie.read(request);

    if (token !== null) {
      await this.refreshTokens.revokeByToken(token);
    }

    this.cookie.clear(response);
  }

  @Get(AUTH_ROUTES.me)
  @UseGuards(AccessTokenGuard)
  me(@CurrentAuth() auth: AuthContext): { user: PublicUser } {
    return { user: this.presenter.toPublic(auth.user) };
  }

  @Get(AUTH_ROUTES.sessions)
  @UseGuards(AccessTokenGuard)
  async listSessions(@CurrentAuth() auth: AuthContext): Promise<SessionListResponse> {
    return this.sessions.listFor(auth.user.id, auth.sessionId);
  }

  @Delete(`${AUTH_ROUTES.sessions}/:id`)
  @UseGuards(AccessTokenGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @CurrentAuth() auth: AuthContext,
    @Param("id") sessionId: string,
  ): Promise<void> {
    await this.sessions.revokeFor(auth.user.id, sessionId);
  }

  private async respondWithSession(
    user: Parameters<SessionIssuer["issueFor"]>[0],
    request: Request,
    response: Response,
  ): Promise<AuthenticatedResponse> {
    const issued = await this.issuer.issueFor(user, this.origins.resolve(request));

    this.cookie.write(response, issued.refresh.token, issued.refresh.expiresAt);

    return issued.body;
  }
}
