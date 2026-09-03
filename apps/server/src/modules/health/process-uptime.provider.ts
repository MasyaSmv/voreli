import { Injectable } from "@nestjs/common";

import type { UptimeProvider } from "./health.contracts.js";

@Injectable()
export class ProcessUptimeProvider implements UptimeProvider {
  seconds(): number {
    return process.uptime();
  }
}
