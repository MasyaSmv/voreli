import { Module } from "@nestjs/common";

import { MediaConfig } from "./media.config.js";
import { RouterRegistryService } from "./router-registry.service.js";
import { TransportFactory } from "./transport.factory.js";
import { WorkerPoolService } from "./worker-pool.service.js";

@Module({
  providers: [MediaConfig, WorkerPoolService, RouterRegistryService, TransportFactory],
  exports: [RouterRegistryService, TransportFactory],
})
export class MediaModule {}
