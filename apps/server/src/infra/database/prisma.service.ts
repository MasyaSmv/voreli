import { AsyncLocalStorage } from "node:async_hooks";

import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { type Prisma, PrismaClient } from "@prisma/client";

/**
 * Database access plus a transactional context.
 *
 * Composition, not inheritance, and that is not a style preference: PrismaClient returns a
 * Proxy from its constructor, and the model properties live on that Proxy. Inside a getter
 * of a subclass, `this` is the underlying target rather than the Proxy, so returning `this`
 * hands back an object with no models on it — every call fails with
 * "Cannot read properties of undefined". Holding the client in a field sidesteps the whole
 * problem.
 *
 * Services never touch the client directly — they read `db`, which returns the transaction
 * of the current call when there is one and the plain client otherwise. That indirection
 * buys two things: a service can be composed into someone else's transaction without
 * knowing it, and a test can wrap its whole body in a transaction that is rolled back,
 * instead of recreating the schema per test.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client = new PrismaClient();

  private readonly logger = new Logger(PrismaService.name);
  private readonly transaction = new AsyncLocalStorage<Prisma.TransactionClient>();
  private testTransaction: Prisma.TransactionClient | null = null;

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
    this.logger.log("Database connection established");
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  /** The client every repository and service should use. */
  get db(): Prisma.TransactionClient {
    return this.transaction.getStore() ?? this.testTransaction ?? this.client;
  }

  /**
   * Runs `work` inside a transaction. Joins the surrounding one if there already is one,
   * so a service calling another service does not open a second, independent transaction
   * that could commit while the outer one rolls back.
   */
  async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    const active = this.transaction.getStore() ?? this.testTransaction;

    if (active) {
      return work();
    }

    return this.client.$transaction((tx) => this.transaction.run(tx, work));
  }

  /**
   * Test-only. Binds a transaction the test harness opened, so everything a test writes is
   * rolled back at the end of it.
   *
   * This cannot use the AsyncLocalStorage above: the transaction is opened in `beforeEach`
   * and the test body runs in a different async context, where the store is not visible.
   * A field is the honest way to express "the whole process is inside one transaction now".
   */
  useTransactionForTests(tx: Prisma.TransactionClient | null): void {
    this.testTransaction = tx;
  }
}
