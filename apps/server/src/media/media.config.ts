import { availableParallelism } from "node:os";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { types } from "mediasoup";

import type { EnvironmentVariables } from "../config/env.validation.js";

export const VOICE_MEDIA_CODECS: readonly types.RouterRtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48_000,
    channels: 2,
    parameters: {
      useinbandfec: 1,
      usedtx: 1,
      maxaveragebitrate: 40_000,
      stereo: 0,
    },
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90_000,
    parameters: {},
    rtcpFeedback: [
      { type: "nack" },
      { type: "nack", parameter: "pli" },
      { type: "ccm", parameter: "fir" },
      { type: "goog-remb" },
      { type: "transport-cc" },
    ],
  },
  {
    kind: "video",
    mimeType: "video/H264",
    clockRate: 90_000,
    parameters: {
      "packetization-mode": 1,
      "level-asymmetry-allowed": 1,
      "profile-level-id": "42e01f",
    },
    rtcpFeedback: [
      { type: "nack" },
      { type: "nack", parameter: "pli" },
      { type: "ccm", parameter: "fir" },
      { type: "goog-remb" },
      { type: "transport-cc" },
    ],
  },
];

@Injectable()
export class MediaConfig {
  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

  get workerCount(): number {
    return Math.min(
      availableParallelism(),
      this.config.get("MEDIASOUP_MAX_WORKERS", { infer: true }) ?? Infinity,
    );
  }

  get listenIp(): string {
    return this.config.get("MEDIASOUP_LISTEN_IP", { infer: true });
  }

  get announcedIp(): string {
    return this.config.get("MEDIASOUP_ANNOUNCED_IP", { infer: true });
  }

  get minimumPort(): number {
    return this.config.get("MEDIASOUP_RTC_MIN_PORT", { infer: true });
  }

  get maximumPort(): number {
    return this.config.get("MEDIASOUP_RTC_MAX_PORT", { infer: true });
  }

  get logLevel(): types.WorkerLogLevel {
    return this.config.get("MEDIASOUP_LOG_LEVEL", { infer: true });
  }

  get routerIdleTtlMs(): number {
    return this.config.get("ROUTER_IDLE_TTL", { infer: true }) * 1_000;
  }

  assertWorkerPortsFit(): void {
    const portCount = this.maximumPort - this.minimumPort + 1;

    if (this.workerCount > portCount) {
      throw new Error(
        `Mediasoup needs ${String(this.workerCount)} worker ports, but only ${String(portCount)} are configured`,
      );
    }
  }
}
