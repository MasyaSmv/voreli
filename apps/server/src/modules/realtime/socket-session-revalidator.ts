import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { CLOCK, type Clock } from "../../common/services/clock.js";
import type { EnvironmentVariables } from "../../config/env.validation.js";
import type { AuthenticatedSocket } from "./authenticated.gateway.js";
import { type SocketIdentity, SocketIdentityService } from "./socket-identity.service.js";

interface RevalidationState {
  readonly sessionId: string;
  checkedAt: number;
  pending?: Promise<boolean>;
}

/** Coalesces lazy database checks and owns their per-socket timestamps. */
@Injectable()
export class SocketSessionRevalidator {
  private readonly intervalMs: number;
  private readonly states = new WeakMap<AuthenticatedSocket, RevalidationState>();

  constructor(
    private readonly identities: SocketIdentityService,
    @Inject(CLOCK) private readonly clock: Clock,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.intervalMs = config.get("SOCKET_REVALIDATE_INTERVAL", { infer: true }) * 1000;
  }

  recordValidated(socket: AuthenticatedSocket, identity: SocketIdentity): void {
    this.states.set(socket, {
      sessionId: identity.sessionId,
      checkedAt: this.clock.now().getTime(),
    });
  }

  async isActive(socket: AuthenticatedSocket, identity: SocketIdentity): Promise<boolean> {
    const state = this.states.get(socket);

    if (!state || state.sessionId !== identity.sessionId) {
      this.recordValidated(socket, identity);

      return true;
    }

    if (state.pending) {
      return state.pending;
    }

    if (this.clock.now().getTime() - state.checkedAt < this.intervalMs) {
      return true;
    }

    const pending = this.identities.isActive(identity).then(
      (active) => {
        state.checkedAt = this.clock.now().getTime();
        delete state.pending;

        return active;
      },
      (error: unknown) => {
        delete state.pending;
        throw error;
      },
    );
    state.pending = pending;

    return pending;
  }
}
