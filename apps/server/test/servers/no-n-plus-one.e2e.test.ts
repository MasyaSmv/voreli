import { createId } from "@paralleldrive/cuid2";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Factories } from "../support/factories.js";
import { createTestApp, type TestApp } from "../support/test-app.js";

/**
 * Guards the rule from AGENTS.md that performance is designed in, not bolted on: rendering
 * a server must cost a fixed number of queries regardless of how many channels it has.
 *
 * Written as a comparison rather than an absolute number so it fails on the shape of the
 * problem (growth per channel) and not on an unrelated extra query somewhere.
 */
describe("server view query count", () => {
  let harness: TestApp;
  let factories: Factories;
  let counted = 0;
  let counting = false;

  beforeAll(async () => {
    harness = await createTestApp();
    factories = new Factories(harness.prisma);

    harness.prisma.client.$on("query", () => {
      if (counting) {
        counted += 1;
      }
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.beginTransaction();
  });

  afterEach(async () => {
    await harness.rollbackTransaction();
  });

  async function queriesToRenderServer(channelCount: number): Promise<number> {
    const seeded = await factories.server();
    const user = await factories.member(seeded);

    for (let index = 0; index < channelCount; index += 1) {
      await harness.prisma.db.channel.create({
        data: {
          id: createId(),
          serverId: seeded.serverId,
          type: "TEXT",
          name: `channel-${String(index)}`,
          position: index,
        },
      });
    }

    const login = await request(harness.app.getHttpServer())
      .post("/auth/login")
      .send({ username: user.username, password: user.password })
      .expect(200);

    // Prisma has no way to remove a listener, so one listener is registered for the whole
    // file and the counter is reset around the request being measured.
    counted = 0;
    counting = true;

    await request(harness.app.getHttpServer())
      .get(`/servers/${seeded.serverId}`)
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .expect(200);

    counting = false;

    return counted;
  }

  it("does not grow with the number of channels", async () => {
    const few = await queriesToRenderServer(2);
    const many = await queriesToRenderServer(20);


    // Ten times the channels must not mean ten times the queries. A little slack allows for
    // an extra query or two that does not scale with the list.
    expect(many).toBeLessThanOrEqual(few + 3);

    // A budget, not a measurement: rendering one server takes 16 queries today, and this
    // catches a change that quietly doubles it without adding an N+1.
    expect(few).toBeLessThanOrEqual(25);
  });
});
