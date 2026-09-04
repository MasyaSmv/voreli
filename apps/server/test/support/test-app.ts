import type { Server } from "node:http";

import { type INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Prisma } from "@prisma/client";
import cookieParser from "cookie-parser";

import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/infra/database/prisma.service.js";
import { RedisClientFactory } from "../../src/infra/redis/redis-client.factory.js";

/** Thrown to unwind the per-test transaction; never escapes the harness. */
class RollbackSignal extends Error {
  constructor() {
    super("rollback");
    this.name = "RollbackSignal";
  }
}

export interface TestApp {
  readonly app: INestApplication;
  /** Port the app listens on when started with `listen()`; 0 until then. */
  port(): number;
  listen(): Promise<number>;
  readonly prisma: PrismaService;
  /** Opens a transaction and binds it, so everything written in the test is undone. */
  beginTransaction(): Promise<void>;
  /** Drops every rate limit counter, so one test's attempts never limit the next one. */
  resetRateLimits(): Promise<void>;
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
  const redis = app.get(RedisClientFactory).create();
  await redis.connect();

  /**
   * Rate limit counters live in Redis, not in the transaction, so the rollback does not
   * reach them. A suite that logs in once per test would otherwise exhaust the login
   * allowance and fail on the limiter rather than on what it set out to check.
   */
  async function resetRateLimits(): Promise<void> {
    const keys = await redis.keys("voreli:ratelimit:*");

    if (keys.length > 0) {
      await redis.del(keys);
    }
  }

  let boundPort = 0;
  let finish: (() => void) | null = null;
  let running: Promise<void> | null = null;

  return {
    app,
    prisma,

    port: () => boundPort,

    /**
     * Socket.IO needs a real listening port: the in-memory supertest transport cannot carry
     * a websocket upgrade.
     */
    async listen(): Promise<number> {
      if (boundPort !== 0) {
        return boundPort;
      }

      await app.listen(0);

      // Nest types getHttpServer() as any; narrow it once, here.
      const server = app.getHttpServer() as Server;
      const address = server.address();
      boundPort = typeof address === "object" && address !== null ? address.port : 0;

      return boundPort;
    },

    resetRateLimits,

    async beginTransaction(): Promise<void> {
      await resetRateLimits();

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
      if (redis.isOpen) {
        await redis.quit();
      }

      await app.close();
    },
  };
}
