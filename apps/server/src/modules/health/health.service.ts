import { Inject, Injectable } from "@nestjs/common";
import type { HealthResponse } from "@voreli/shared";

import {
  APP_VERSION_PROVIDER,
  type AppVersionProvider,
  UPTIME_PROVIDER,
  type UptimeProvider,
} from "./health.contracts.js";

@Injectable()
export class HealthService {
  constructor(
    @Inject(UPTIME_PROVIDER) private readonly uptime: UptimeProvider,
    @Inject(APP_VERSION_PROVIDER) private readonly appVersion: AppVersionProvider,
  ) {}

  status(): HealthResponse {
    return {
      status: "ok",
      uptime: this.uptime.seconds(),
      version: this.appVersion.version(),
    };
  }
}
