import { type INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Prisma } from "@prisma/client";
import cookieParser from "cookie-parser";

import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/infra/database/prisma.service.js";

/** Thrown to unwind the per-test transaction; never escapes the harness. */
class RollbackSignal extends Error {
  constructor() {
    super("rollback");
    this.name = "RollbackSignal";
  }
}

export interface TestApp {
  readonly app: INestApplication;
  readonly prisma: PrismaService;
  /** Opens a transaction and binds it, so everything written in the test is undone. */
  beginTransaction(): Promise<void>;
  rollbackTransaction(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Boots the real application against the real test database.
 *
 * Nothing is mocked and nothing is overridden: the services under test are the ones the
 * production container builds, which is the only way a passing test says anything about
 * production. See docs/specs/002-data-model-and-auth.md.
 */
export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  const prisma = app.get(PrismaService);
  let finish: (() => void) | null = null;
  let running: Promise<void> | null = null;

  return {
    app,
    prisma,

    async beginTransaction(): Promise<void> {
      await new Promise<void>((ready, failed) => {
        running = prisma.client
          .$transaction(
            async (tx: Prisma.TransactionClient) => {
              prisma.useTransactionForTests(tx);
              ready();

              // Hold the transaction open until the test says it is done.
              await new Promise<never>((_, reject) => {
                finish = () => {
                  reject(new RollbackSignal());
                };
              });
            },
            { timeout: 30_000, maxWait: 10_000 },
          )
          .catch((error: unknown) => {
            if (error instanceof RollbackSignal) {
              return;
            }

            failed(error instanceof Error ? error : new Error(String(error)));
            throw error;
          })
          .finally(() => {
            prisma.useTransactionForTests(null);
          });
      });
    },

    async rollbackTransaction(): Promise<void> {
      finish?.();
      await running;
      finish = null;
      running = null;
    },

    async close(): Promise<void> {
      await app.close();
    },
  };
}
