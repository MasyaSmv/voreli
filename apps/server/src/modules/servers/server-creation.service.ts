import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Server } from "@prisma/client";
import { DEFAULT_EVERYONE_PERMISSIONS } from "@voreli/shared";

import { ID_GENERATOR, type IdGenerator } from "../../common/services/id-generator.js";
import { PrismaService } from "../../infra/database/prisma.service.js";

/** Names the product starts a fresh server with, so it is never an empty shell. */
const STARTER_CATEGORY = "Общее";
const STARTER_TEXT_CHANNEL = "основной";
const STARTER_VOICE_CHANNEL = "Голосовой";

/**
 * Creates a server in the only state the domain considers valid: with an @everyone role,
 * with its owner as a member holding that role, and with somewhere to talk.
 *
 * All of it in one transaction — a server that exists without @everyone would break every
 * permission check made against it, and "repair it later" is how invariants rot.
 */
@Injectable()
export class ServerCreationService {
  private readonly logger = new Logger(ServerCreationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async create(ownerId: string, name: string): Promise<Server> {
    return this.prisma.runInTransaction(async () => {
      const serverId = this.ids.generate();
      const everyoneRoleId = this.ids.generate();
      const categoryId = this.ids.generate();

      const server = await this.prisma.db.server.create({
        data: { id: serverId, name: name.trim(), ownerId },
      });

      await this.prisma.db.role.create({
        data: {
          id: everyoneRoleId,
          serverId,
          name: "@everyone",
          isDefault: true,
          position: 0,
          permissions: DEFAULT_EVERYONE_PERMISSIONS,
        },
      });

      await this.prisma.db.member.create({
        data: {
          id: this.ids.generate(),
          serverId,
          userId: ownerId,
          roles: { create: { roleId: everyoneRoleId } },
        },
      });

      await this.prisma.db.category.create({
        data: { id: categoryId, serverId, name: STARTER_CATEGORY, position: 0 },
      });

      await this.prisma.db.channel.createMany({
        data: [
          {
            id: this.ids.generate(),
            serverId,
            categoryId,
            type: "TEXT",
            name: STARTER_TEXT_CHANNEL,
            position: 0,
          },
          {
            id: this.ids.generate(),
            serverId,
            categoryId,
            type: "VOICE",
            name: STARTER_VOICE_CHANNEL,
            position: 1,
          },
        ],
      });

      this.logger.log(`Server ${serverId} created by ${ownerId}`);

      return server;
    });
  }
}
