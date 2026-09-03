import { Global, Module } from "@nestjs/common";

import { PrismaService } from "./prisma.service.js";

/**
 * Global because every domain module needs the database, and re-importing the same module
 * in each of them is noise, not architecture.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
