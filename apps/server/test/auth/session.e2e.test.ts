import { AUTH_ROUTES, REFRESH_COOKIE } from "@voreli/shared";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

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

describe("login, refresh and sessions", () => {
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

  const logIn = () =>
    http()
      .post(AUTH_ROUTES.login)
      .send({ username: user.username, password: user.password })
      .expect(200);

  it("issues a token pair for the right password", async () => {
    const response = await logIn();

    expect(response.body.user.username).toBe(user.username);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(refreshCookieOf(response)).toContain(REFRESH_COOKIE);
  });

  it("answers the same way for a wrong password and an unknown user", async () => {
    const wrongPassword = await http()
      .post(AUTH_ROUTES.login)
      .send({ username: user.username, password: "definitely not it" })
      .expect(401);

    const unknownUser = await http()
      .post(AUTH_ROUTES.login)
      .send({ username: "nobody-here", password: "definitely not it" })
      .expect(401);

    expect(wrongPassword.body).toEqual(unknownUser.body);
    expect(wrongPassword.body.errorCode).toBe("INVALID_CREDENTIALS");
  });

  it("returns the current user behind a valid access token", async () => {
    const { body } = await logIn();

    const me = await http()
      .get(AUTH_ROUTES.me)
      .set("Authorization", `Bearer ${body.accessToken}`)
      .expect(200);

    expect(me.body.user.id).toBe(user.id);
  });

  it("refuses /auth/me without a token and with a broken one", async () => {
    await http().get(AUTH_ROUTES.me).expect(401);
    await http().get(AUTH_ROUTES.me).set("Authorization", "Bearer not-a-jwt").expect(401);
  });

  it("rotates the refresh token and keeps the old one unusable", async () => {
    const login = await logIn();
    const first = refreshCookieOf(login);

    const refreshed = await http().post(AUTH_ROUTES.refresh).set("Cookie", first).expect(200);
    const second = refreshCookieOf(refreshed);

    expect(second).not.toBe(first);
    expect(refreshed.body.accessToken).toEqual(expect.any(String));

    await http().post(AUTH_ROUTES.refresh).set("Cookie", second).expect(200);
  });

  it("kills every session when a rotated token comes back", async () => {
    const login = await logIn();
    const stolen = refreshCookieOf(login);

    await http().post(AUTH_ROUTES.refresh).set("Cookie", stolen).expect(200);

    const replay = await http().post(AUTH_ROUTES.refresh).set("Cookie", stolen).expect(401);
    expect(replay.body.errorCode).toBe("SESSION_REUSE_DETECTED");

    const alive = await harness.prisma.db.refreshSession.count({
      where: { userId: user.id, revokedAt: null },
    });

    expect(alive).toBe(0);
  });

  it("stops the access token of a revoked session from working", async () => {
    const login = await logIn();
    const accessToken = login.body.accessToken as string;

    await http()
      .get(AUTH_ROUTES.me)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    await http()
      .post(AUTH_ROUTES.logout)
      .set("Cookie", refreshCookieOf(login))
      .expect(204);

    await http()
      .get(AUTH_ROUTES.me)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(401);
  });

  it("lists sessions and marks the current one", async () => {
    const first = await logIn();
    await logIn();

    const sessions = await http()
      .get(AUTH_ROUTES.sessions)
      .set("Authorization", `Bearer ${first.body.accessToken}`)
      .expect(200);

    expect(sessions.body.sessions).toHaveLength(2);
    expect(sessions.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
  });

  it("revokes one session without touching the others", async () => {
    const keeper = await logIn();
    const doomed = await logIn();

    const sessions = await http()
      .get(AUTH_ROUTES.sessions)
      .set("Authorization", `Bearer ${keeper.body.accessToken}`)
      .expect(200);

    const other = sessions.body.sessions.find((s: { current: boolean }) => !s.current) as {
      id: string;
    };

    await http()
      .delete(`${AUTH_ROUTES.sessions}/${other.id}`)
      .set("Authorization", `Bearer ${keeper.body.accessToken}`)
      .expect(204);

    await http()
      .get(AUTH_ROUTES.me)
      .set("Authorization", `Bearer ${keeper.body.accessToken}`)
      .expect(200);

    await http()
      .get(AUTH_ROUTES.me)
      .set("Authorization", `Bearer ${doomed.body.accessToken}`)
      .expect(401);
  });

  it("refuses to revoke a session belonging to someone else", async () => {
    const victim = await factories.member(server, "another password entirely");
    const victimLogin = await http()
      .post(AUTH_ROUTES.login)
      .send({ username: victim.username, password: victim.password })
      .expect(200);

    const victimSessions = await http()
      .get(AUTH_ROUTES.sessions)
      .set("Authorization", `Bearer ${victimLogin.body.accessToken}`)
      .expect(200);

    const attacker = await logIn();

    await http()
      .delete(`${AUTH_ROUTES.sessions}/${victimSessions.body.sessions[0].id}`)
      .set("Authorization", `Bearer ${attacker.body.accessToken}`)
      .expect(404);

    await http()
      .get(AUTH_ROUTES.me)
      .set("Authorization", `Bearer ${victimLogin.body.accessToken}`)
      .expect(200);
  });

  it("refuses a refresh request with no cookie at all", async () => {
    await http().post(AUTH_ROUTES.refresh).expect(401);
  });
});
