import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";

import type { EnvironmentVariables } from "../../config/env.validation.js";
import { AccessTokenGuard } from "./access-token.guard.js";
import { AccessTokenService } from "./access-token.service.js";
import { AuthController } from "./auth.controller.js";
import { InviteRedemptionService } from "./invite-redemption.service.js";
import { LoginService } from "./login.service.js";
import { RefreshCookie } from "./refresh-cookie.js";
import { RefreshTokenService } from "./refresh-token.service.js";
import { RegistrationService } from "./registration.service.js";
import { SessionIssuer } from "./session-issuer.service.js";
import { SessionListService } from "./session-list.service.js";
import { SessionOriginResolver } from "./session-origin.resolver.js";
import { UserPresenter } from "./user-presenter.js";

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        secret: config.get("JWT_SECRET", { infer: true }),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AccessTokenGuard,
    AccessTokenService,
    InviteRedemptionService,
    LoginService,
    RefreshCookie,
    RefreshTokenService,
    RegistrationService,
    SessionIssuer,
    SessionListService,
    SessionOriginResolver,
    UserPresenter,
  ],
  exports: [AccessTokenGuard, AccessTokenService, InviteRedemptionService, UserPresenter],
})
export class AuthModule {}
