import { AUTH_ROUTES } from "@voreli/shared";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { RATE_LIMITS } from "../../src/common/rate-limit/rate-limit.module.js";
import { Factories, type SeededServer, type SeededUser } from "../support/factories.js";
import { createTestApp, type TestApp } from "../support/test-app.js";

/**
 * The limiter runs against the real Redis counter the application uses, not a substitute:
 * a limit that is only proven against an in-memory stand-in says nothing about the one
 * shared by several instances, which is the whole reason it lives in Redis.
 */
describe("rate limiting", () => {
  let harness: TestApp;
  let factories: Factories;
  let server: SeededServer;
  let user: SeededUser;

  beforeAll(async () => {
    harness = await createTestApp();
    factories = new Factories(harness.prisma);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.beginTransaction();
    server = await factories.server();
    user = await factories.member(server);
  });

  afterEach(async () => {
    await harness.rollbackTransaction();
  });

  const http = () => request(harness.app.getHttpServer());

  it("refuses further login attempts once the allowance is spent", async () => {
    const attempts = RATE_LIMITS.login.limit;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await http()
        .post(AUTH_ROUTES.login)
        .send({ username: user.username, password: "wrong password entirely" })
        .expect(401);
    }

    const refused = await http()
      .post(AUTH_ROUTES.login)
      .send({ username: user.username, password: "wrong password entirely" })
      .expect(429);

    expect(refused.body.errorCode).toBe("RATE_LIMITED");
  });

  it("keeps refusing a correct password while the window is still open", async () => {
    for (let attempt = 0; attempt < RATE_LIMITS.login.limit; attempt += 1) {
      await http()
        .post(AUTH_ROUTES.login)
        .send({ username: user.username, password: "wrong password entirely" })
        .expect(401);
    }

    // The point of the limit: guessing the password on the last allowed attempt does not
    // buy the attacker an unlimited stream of further ones.
    await http()
      .post(AUTH_ROUTES.login)
      .send({ username: user.username, password: user.password })
      .expect(429);
  });

  it("refuses registration once its own, stricter allowance is spent", async () => {
    for (let attempt = 0; attempt < RATE_LIMITS.register.limit; attempt += 1) {
      await http()
        .post(AUTH_ROUTES.register)
        .send({
          inviteCode: server.inviteCode,
          username: `applicant-${String(attempt)}`,
          password: "long enough password",
        })
        .expect(201);
    }

    const refused = await http()
      .post(AUTH_ROUTES.register)
      .send({
        inviteCode: server.inviteCode,
        username: "one-too-many",
        password: "long enough password",
      })
      .expect(429);

    expect(refused.body.errorCode).toBe("RATE_LIMITED");
  });
});
