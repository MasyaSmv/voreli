import { createId } from "@paralleldrive/cuid2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestApp, type TestApp } from "../support/test-app.js";

/**
 * The only test file that deliberately runs OUTSIDE the per-test transaction, and it exists
 * because of a real bug: `db` used to return `this` from a class extending PrismaClient,
 * which is the Proxy target rather than the Proxy, so every model was undefined. Every
 * other test passed, because inside a transaction `db` returns the transaction client and
 * never reaches that branch. It cleans up after itself.
 */
describe("PrismaService outside a transaction", () => {
  let harness: TestApp;

  beforeAll(async () => {
    harness = await createTestApp();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("exposes models on the plain client", () => {
    expect(harness.prisma.db.user).toBeDefined();
    expect(harness.prisma.db.invite).toBeDefined();
    expect(harness.prisma.db.refreshSession).toBeDefined();
  });

  it("reads and writes without a surrounding transaction", async () => {
    const id = createId();

    await harness.prisma.db.user.create({
      data: { id, username: `plain-${id.slice(0, 8)}`, displayName: "Plain", passwordHash: "x" },
    });

    try {
      const found = await harness.prisma.db.user.findUnique({ where: { id } });
      expect(found?.id).toBe(id);
    } finally {
      await harness.prisma.db.user.delete({ where: { id } });
    }
  });

  it("opens a real transaction and rolls it back on failure", async () => {
    const id = createId();

    await expect(
      harness.prisma.runInTransaction(async () => {
        await harness.prisma.db.user.create({
          data: {
            id,
            username: `rolled-${id.slice(0, 8)}`,
            displayName: "Rolled",
            passwordHash: "x",
          },
        });

        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await harness.prisma.db.user.findUnique({ where: { id } })).toBeNull();
  });
});
