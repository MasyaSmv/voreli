import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { TransportDirection } from "@voreli/shared";
import type { types } from "mediasoup";

import type { EnvironmentVariables } from "../../config/env.validation.js";
import type { TransportFailureObserver } from "./transport-failure-observer.js";

@Injectable()
export class TransportRecoveryService {
  private readonly logger = new Logger(TransportRecoveryService.name);
  private readonly observers = new Set<TransportFailureObserver>();
  private readonly reconnecting = new Map<string, Set<string>>();
  private readonly failed = new Set<string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly graceMs: number;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.graceMs = config.get("VOICE_RECONNECT_GRACE", { infer: true }) * 1_000;
  }

  subscribe(observer: TransportFailureObserver): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  register(sessionId: string): void {
    this.failed.delete(sessionId);
  }

  closeSession(sessionId: string): void {
    this.reconnecting.delete(sessionId);
  }

  observe(
    sessionId: string,
    direction: TransportDirection,
    transport: types.WebRtcTransport,
  ): void {
    transport.observer.once("close", () => this.clear(sessionId, transport.id));
    transport.on("dtlsstatechange", (state) => {
      this.logger.log({
        message: "Voice transport DTLS state changed",
        sessionId,
        transportId: transport.id,
        direction,
        state,
      });
      if (state === "closed" || state === "failed") this.transportFailed(sessionId, transport);
    });
    transport.on("icestatechange", (state) => {
      this.logger.log({
        message: "Voice transport ICE state changed",
        sessionId,
        transportId: transport.id,
        direction,
        state,
      });
      if (state === "closed") this.transportFailed(sessionId, transport);
      else if (state === "disconnected") {
        this.markReconnecting(sessionId, transport.id);
        this.scheduleFailure(sessionId, transport);
      } else if (state === "connected" || state === "completed")
        this.clear(sessionId, transport.id);
    });
  }

  clear(sessionId: string, transportId: string): void {
    const timer = this.timers.get(transportId);
    if (timer) clearTimeout(timer);
    this.timers.delete(transportId);
    const transports = this.reconnecting.get(sessionId);
    if (!transports?.delete(transportId) || transports.size > 0) return;
    this.reconnecting.delete(sessionId);
    this.emitReconnect(sessionId, false);
  }

  private transportFailed(sessionId: string, transport: types.WebRtcTransport): void {
    const timer = this.timers.get(transport.id);
    if (timer) clearTimeout(timer);
    this.timers.delete(transport.id);
    if (this.failed.has(sessionId)) return;
    this.failed.add(sessionId);
    this.markReconnecting(sessionId, transport.id);
    if (this.observers.size === 0 && !transport.closed) {
      transport.close();
      return;
    }
    for (const observer of this.observers) {
      void Promise.resolve()
        .then(() => observer.transportFailed(sessionId))
        .catch((error: unknown) =>
          this.logger.error({
            message: "Failed to close voice session after transport failure",
            error,
            sessionId,
            transportId: transport.id,
            operation: "handleVoiceTransportFailure",
          }),
        )
        .finally(() => {
          if (!transport.closed) transport.close();
        });
    }
  }

  private scheduleFailure(sessionId: string, transport: types.WebRtcTransport): void {
    if (this.timers.has(transport.id)) return;
    const timer = setTimeout(() => {
      this.timers.delete(transport.id);
      if (!transport.closed) this.transportFailed(sessionId, transport);
    }, this.graceMs);
    timer.unref();
    this.timers.set(transport.id, timer);
  }

  private markReconnecting(sessionId: string, transportId: string): void {
    const transports = this.reconnecting.get(sessionId) ?? new Set<string>();
    if (transports.has(transportId)) return;
    const wasReconnecting = transports.size > 0;
    transports.add(transportId);
    this.reconnecting.set(sessionId, transports);
    if (!wasReconnecting) this.emitReconnect(sessionId, true);
  }

  private emitReconnect(sessionId: string, reconnecting: boolean): void {
    for (const observer of this.observers) {
      void Promise.resolve(observer.transportReconnectChanged(sessionId, reconnecting)).catch(
        (error: unknown) => {
          this.logger.error({
            message: "Failed to publish voice transport reconnect state",
            error,
            sessionId,
            reconnecting,
            operation: "publishVoiceTransportReconnect",
          });
        },
      );
    }
  }
}
