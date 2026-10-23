import { Inject, Injectable, Logger, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { CommonModule } from "./common/common.module.js";
import { ID_GENERATOR, type IdGenerator } from "./common/services/id-generator.js";
import { PASSWORD_HASHER, type PasswordHasher } from "./common/services/password-hasher.js";
import { DatabaseModule } from "./infra/database/database.module.js";
import { PrismaService } from "./infra/database/prisma.service.js";
import { ServerCreationService } from "./modules/servers/server-creation.service.js";

@Injectable()
class InitialOwnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly servers: ServerCreationService,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
  ) {}

  async ensure(password: string): Promise<boolean> {
    if (await this.prisma.db.user.findFirst({ select: { id: true } })) {
      return false;
    }

    const passwordHash = await this.passwords.hash(password);
    await this.prisma.runInTransaction(async () => {
      const owner = await this.prisma.db.user.create({
        data: {
          id: this.ids.generate(),
          username: "owner",
          displayName: "Owner",
          passwordHash,
          contactSettings: { create: {} },
        },
      });

      await this.servers.create(owner.id, "Voreli");
    });

    return true;
  }
}

@Module({
  imports: [CommonModule, DatabaseModule],
  providers: [InitialOwnerService, ServerCreationService],
})
class TailnetBootstrapModule {}

async function main(): Promise<void> {
  const password = process.env.INITIAL_OWNER_PASSWORD;
  if (!password || password.length < 24) {
    throw new Error("INITIAL_OWNER_PASSWORD must be at least 24 characters");
  }

  const app = await NestFactory.createApplicationContext(TailnetBootstrapModule);
  try {
    const created = await app.get(InitialOwnerService).ensure(password);
    Logger.log(
      created ? "Initial owner and starter server created" : "Existing users kept",
      "TailnetBootstrap",
    );
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  Logger.error(error, "TailnetBootstrap");
  process.exitCode = 1;
});
