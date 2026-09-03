import { AUTH_ROUTES, REFRESH_COOKIE } from "@voreli/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Factories, type SeededServer, type SeededUser } from "../support/factories.js";
import { createTestApp, type TestApp } from "../support/test-app.js";

function refreshCookieOf(response: { headers: Record<string, unknown> }): string {
  const cookies = response.headers["set-cookie"] as string[] | undefined;
  const cookie = cookies?.find((candidate) => candidate.startsWith(REFRESH_COOKIE));

  if (cookie === undefined) {
    throw new Error("Response carried no refresh cookie");
  }

  return cookie.split(";")[0] ?? "";
}

/**
 * Runs WITHOUT the per-test transaction, on purpose.
 *
 * Theft handling revokes sessions and then throws. Inside the harness transaction the throw
 * unwinds nothing, so the same test passed even when the revocation was silently rolled
 * back in production — the bug was only visible against a real server. Anything whose
 * correctness depends on an effect surviving an exception belongs here, not in the
 * transactional suite. Cleans up after itself.
 */
describe("refresh token theft, against a committing database", () => {
  let harness: TestApp;
  let factories: Factories;
  let server: SeededServer;
  let user: SeededUser;

  beforeAll(async () => {
    harness = await createTestApp();
    factories = new Factories(harness.prisma);
    server = await factories.server();
    user = await factories.member(server);
  });

  afterAll(async () => {
    await harness.prisma.db.server.delete({ where: { id: server.serverId } });
    await harness.prisma.db.user.deleteMany({
      where: { id: { in: [server.ownerId, user.id] } },
    });
    await harness.close();
  });

  const http = () => request(harness.app.getHttpServer());

  it("really revokes every session when a rotated token is replayed", async () => {
    const login = await http()
      .post(AUTH_ROUTES.login)
      .send({ username: user.username, password: user.password })
      .expect(200);

    const stolen = refreshCookieOf(login);
    const rotated = await http().post(AUTH_ROUTES.refresh).set("Cookie", stolen).expect(200);
    const legitimate = refreshCookieOf(rotated);

    const replay = await http().post(AUTH_ROUTES.refresh).set("Cookie", stolen).expect(401);
    expect(replay.body.errorCode).toBe("SESSION_REUSE_DETECTED");

    // The point of the whole test: the honest holder is logged out too, and the revocation
    // survived the exception that reported it.
    await http().post(AUTH_ROUTES.refresh).set("Cookie", legitimate).expect(401);

    const alive = await harness.prisma.db.refreshSession.count({
      where: { userId: user.id, revokedAt: null },
    });

    expect(alive).toBe(0);
  });

  it("lets only one of two simultaneous refreshes win", async () => {
    const login = await http()
      .post(AUTH_ROUTES.login)
      .send({ username: user.username, password: user.password })
      .expect(200);

    const cookie = refreshCookieOf(login);

    const [first, second] = await Promise.all([
      http().post(AUTH_ROUTES.refresh).set("Cookie", cookie),
      http().post(AUTH_ROUTES.refresh).set("Cookie", cookie),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 401]);
  });
});
