import { Injectable, Logger } from "@nestjs/common";
import type { Server } from "@prisma/client";

import { PrismaService } from "../../infra/database/prisma.service.js";
import { ResourceNotVisibleError } from "../permissions/errors/permission-errors.js";

/** Renaming and deleting a server: the two operations that are not about its contents. */
@Injectable()
export class ServerAdministrationService {
  private readonly logger = new Logger(ServerAdministrationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async rename(serverId: string, name: string): Promise<Server> {
    return this.prisma.db.server.update({
      where: { id: serverId },
      data: { name: name.trim() },
    });
  }

  async remove(serverId: string): Promise<void> {
    const server = await this.prisma.db.server.findUnique({ where: { id: serverId } });

    if (!server) {
      throw new ResourceNotVisibleError("Server", serverId);
    }

    await this.prisma.db.server.delete({ where: { id: serverId } });
    this.logger.warn(`Server ${serverId} deleted with all of its contents`);
  }

  async byId(serverId: string): Promise<Server> {
    const server = await this.prisma.db.server.findUnique({ where: { id: serverId } });

    if (!server) {
      throw new ResourceNotVisibleError("Server", serverId);
    }

    return server;
  }
}
