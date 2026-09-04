import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { SocketIdentityService } from "./socket-identity.service.js";
import { SocketSessionRegistry } from "./socket-session.registry.js";

@Module({
  imports: [AuthModule],
  providers: [SocketIdentityService, SocketSessionRegistry],
  exports: [SocketIdentityService, SocketSessionRegistry],
})
export class RealtimeModule {}
