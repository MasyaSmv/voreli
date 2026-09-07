import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { SocketAuthenticationService } from "./socket-authentication.service.js";
import { SocketIdentityService } from "./socket-identity.service.js";
import { SocketSessionRegistry } from "./socket-session.registry.js";
import { SocketSessionRevalidator } from "./socket-session-revalidator.js";

@Module({
  imports: [AuthModule],
  providers: [
    SocketAuthenticationService,
    SocketIdentityService,
    SocketSessionRegistry,
    SocketSessionRevalidator,
  ],
  exports: [SocketAuthenticationService],
})
export class RealtimeModule {}
