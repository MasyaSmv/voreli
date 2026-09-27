import { Module } from "@nestjs/common";

import { BOUNDED_PROCESS } from "./bounded-process.js";
import { LinuxBoundedProcess } from "./linux-bounded-process.js";

@Module({
  providers: [LinuxBoundedProcess, { provide: BOUNDED_PROCESS, useExisting: LinuxBoundedProcess }],
  exports: [BOUNDED_PROCESS],
})
export class ProcessModule {}
