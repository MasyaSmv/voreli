import { Injectable } from "@nestjs/common";

import type { AuthenticatedSocket } from "./authenticated.gateway.js";
import { SocketIdentityService } from "./socket-identity.service.js";
import { SocketSessionRegistry } from "./socket-session.registry.js";
import { SocketSessionRevalidator } from "./socket-session-revalidator.js";

/** Owns the authenticated session lifecycle of a Socket.IO connection. */
@Injectable()
export class SocketAuthenticationService {
  constructor(
    private readonly identities: SocketIdentityService,
    private readonly sessions: SocketSessionRegistry,
    private readonly revalidator: SocketSessionRevalidator,
  ) {}

  async authenticate(socket: AuthenticatedSocket, token: string | undefined): Promise<boolean> {
    const identity = await this.identities.identify(token);

    if (!identity) {
      return false;
    }

    await this.sessions.bind(socket, identity);
    this.revalidator.recordValidated(socket, identity);

    return true;
  }

  async refresh(socket: AuthenticatedSocket, accessToken: string): Promise<boolean> {
    const current = socket.identity;
    const refreshed = await this.identities.identify(accessToken);

    if (!current || !refreshed || refreshed.user.id !== current.user.id) {
      return false;
    }

    await this.sessions.move(socket, current, refreshed);
    this.revalidator.recordValidated(socket, refreshed);

    return true;
  }

  async isActive(socket: AuthenticatedSocket): Promise<boolean> {
    const identity = socket.identity;

    return identity ? this.revalidator.isActive(socket, identity) : false;
  }
}
