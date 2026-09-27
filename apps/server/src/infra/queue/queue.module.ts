import { Global, Module } from "@nestjs/common";

import { BACKGROUND_JOB_PUBLISHER } from "./background-job-publisher.js";
import { BullMqJobPublisher } from "./bullmq-job-publisher.js";

@Global()
@Module({
  providers: [
    BullMqJobPublisher,
    { provide: BACKGROUND_JOB_PUBLISHER, useExisting: BullMqJobPublisher },
  ],
  exports: [BACKGROUND_JOB_PUBLISHER],
})
export class QueueModule {}
