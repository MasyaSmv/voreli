import { AUTH_ROUTES, REFRESH_COOKIE } from "@voreli/shared";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Factories, isPublicUser, type SeededServer } from "../support/factories.js";
import { createTestApp, type TestApp } from "../support/test-app.js";

describe("POST /auth/register", () => {
  let harness: TestApp;
  let factories: Factories;
  let server: SeededServer;

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
  });

  afterEach(async () => {
    await harness.rollbackTransaction();
  });

  const http = () => request(harness.app.getHttpServer());

  it("creates the user, joins them to the server and returns a token pair", async () => {
    const response = await http()
      .post(AUTH_ROUTES.register)
      .send({ inviteCode: server.inviteCode, username: "newcomer", password: "long enough pw" })
      .expect(201);

    expect(isPublicUser(response.body.user)).toBe(true);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.expiresIn).toBeGreaterThan(0);

    const cookies = response.headers["set-cookie"] as unknown as string[];
    const refresh = cookies.find((cookie) => cookie.startsWith(REFRESH_COOKIE));
    expect(refresh).toContain("HttpOnly");
    expect(refresh).toContain("SameSite=Lax");

    const membership = await harness.prisma.db.member.findFirst({
      where: { serverId: server.serverId, userId: response.body.user.id },
      include: { roles: true },
    });

    expect(membership).not.toBeNull();
    expect(membership?.roles).toHaveLength(1);
    expect(membership?.roles[0]?.roleId).toBe(server.everyoneRoleId);
  });

  it("counts the invite as used", async () => {
    await http()
      .post(AUTH_ROUTES.register)
      .send({ inviteCode: server.inviteCode, username: "counted", password: "long enough pw" })
      .expect(201);

    const invite = await harness.prisma.db.invite.findUnique({
      where: { code: server.inviteCode },
    });

    expect(invite?.uses).toBe(1);
  });

  it("never returns the password hash", async () => {
    const response = await http()
      .post(AUTH_ROUTES.register)
      .send({ inviteCode: server.inviteCode, username: "secretive", password: "long enough pw" })
      .expect(201);

    expect(JSON.stringify(response.body)).not.toContain("argon2");
    expect(JSON.stringify(response.body)).not.toContain("long enough pw");
  });

  it("treats usernames as case-insensitive", async () => {
    await http()
      .post(AUTH_ROUTES.register)
      .send({ inviteCode: server.inviteCode, username: "Someone", password: "long enough pw" })
      .expect(201);

    const conflict = await http()
      .post(AUTH_ROUTES.register)
      .send({ inviteCode: server.inviteCode, username: "SOMEONE", password: "long enough pw" })
      .expect(409);

    expect(conflict.body.errorCode).toBe("USERNAME_TAKEN");
  });

  it("rejects an invite that does not exist", async () => {
    const response = await http()
      .post(AUTH_ROUTES.register)
      .send({ inviteCode: "no-such-invite", username: "hopeful", password: "long enough pw" })
      .expect(404);

    expect(response.body.errorCode).toBe("INVITE_NOT_FOUND");
  });

  it("rejects an expired invite with its own code", async () => {
    const expired = await factories.server({ expiresAt: new Date(Date.now() - 60_000) });

    const response = await http()
      .post(AUTH_ROUTES.register)
      .send({ inviteCode: expired.inviteCode, username: "late", password: "long enough pw" })
      .expect(410);

    expect(response.body.errorCode).toBe("INVITE_EXPIRED");
  });

  it("rejects an invite that ran out of uses", async () => {
    const limited = await factories.server({ maxUses: 1 });

    await http()
      .post(AUTH_ROUTES.register)
      .send({ inviteCode: limited.inviteCode, username: "first", password: "long enough pw" })
      .expect(201);

    const response = await http()
      .post(AUTH_ROUTES.register)
      .send({ inviteCode: limited.inviteCode, username: "second", password: "long enough pw" })
      .expect(410);

    expect(response.body.errorCode).toBe("INVITE_EXHAUSTED");
  });

  it("rejects a password shorter than the minimum", async () => {
    await http()
      .post(AUTH_ROUTES.register)
      .send({ inviteCode: server.inviteCode, username: "shorty", password: "short" })
      .expect(400);
  });

  it("rejects a username with characters outside the allowed set", async () => {
    await http()
      .post(AUTH_ROUTES.register)
      .send({ inviteCode: server.inviteCode, username: "bad name!", password: "long enough pw" })
      .expect(400);
  });

  it("leaves no user behind when the invite is invalid", async () => {
    await http()
      .post(AUTH_ROUTES.register)
      .send({ inviteCode: "no-such-invite", username: "ghost", password: "long enough pw" })
      .expect(404);

    const user = await harness.prisma.db.user.findUnique({ where: { username: "ghost" } });

    expect(user).toBeNull();
  });
});
