import { Controller, Get } from "@nestjs/common";
import { HEALTH_ROUTE, type HealthResponse } from "@voreli/shared";

import { HealthService } from "./health.service.js";

@Controller(HEALTH_ROUTE)
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  status(): HealthResponse {
    return this.health.status();
  }
}
