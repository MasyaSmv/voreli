import { AUTH_ROUTES } from "@voreli/shared";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { InviteRedemptionService } from "../../src/modules/auth/invite-redemption.service.js";
import { Factories, type SeededServer } from "../support/factories.js";
import { createTestApp, type TestApp } from "../support/test-app.js";

/**
 * The invite counter is the only thing standing between a single-use link and an open door,
 * and it is read and written by requests that arrive together. These tests race the real
 * service against the real database rather than assert on the counter after a quiet
 * sequence of calls, because the sequential path never reproduced the bug in the first
 * place: spec 006, section 7.
 */
describe("invite redemption under concurrency", () => {
  let harness: TestApp;
  let factories: Factories;
  let redemption: InviteRedemptionService;

  beforeAll(async () => {
    harness = await createTestApp();
    factories = new Factories(harness.prisma);
    redemption = harness.app.get(InviteRedemptionService);
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

  const http = () => request(harness.app.getHttpServer());

  const membersOf = (server: SeededServer) =>
    harness.prisma.db.member.count({ where: { serverId: server.serverId } });

  const usesOf = async (server: SeededServer): Promise<number | undefined> =>
    (await harness.prisma.db.invite.findUnique({ where: { code: server.inviteCode } }))?.uses;

  it("admits exactly one of two simultaneous redemptions of a single-use invite", async () => {
    const server = await factories.server({ maxUses: 1 });
    const first = await factories.outsider();
    const second = await factories.outsider();

    const outcomes = await Promise.allSettled([
      redemption.redeem(server.inviteCode, first.id),
      redemption.redeem(server.inviteCode, second.id),
    ]);

    const admitted = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const refused = outcomes.filter((outcome) => outcome.status === "rejected");

    expect(admitted).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]?.reason).toMatchObject({ errorCode: "INVITE_EXHAUSTED" });

    // The owner seeded by the factory is a member too, so one joiner means two rows.
    expect(await membersOf(server)).toBe(2);
    expect(await usesOf(server)).toBe(1);
  });

  it("registers only one of two simultaneous signups on a single-use invite", async () => {
    const server = await factories.server({ maxUses: 1 });

    const responses = await Promise.all([
      http()
        .post(AUTH_ROUTES.register)
        .send({ inviteCode: server.inviteCode, username: "racer-one", password: "long enough pw" }),
      http()
        .post(AUTH_ROUTES.register)
        .send({ inviteCode: server.inviteCode, username: "racer-two", password: "long enough pw" }),
    ]);

    const statuses = responses.map((response) => response.status).sort((a, b) => a - b);

    expect(statuses).toEqual([201, 410]);
    expect(responses.find((response) => response.status === 410)?.body.errorCode).toBe(
      "INVITE_EXHAUSTED",
    );
    expect(await membersOf(server)).toBe(2);
    expect(await usesOf(server)).toBe(1);
  });

  it("lets a limitless invite take every concurrent redemption", async () => {
    const server = await factories.server();
    const joiners = await Promise.all([
      factories.outsider(),
      factories.outsider(),
      factories.outsider(),
    ]);

    await Promise.all(joiners.map((joiner) => redemption.redeem(server.inviteCode, joiner.id)));

    expect(await membersOf(server)).toBe(4);
    expect(await usesOf(server)).toBe(3);
  });

  it("spends no use when an existing member follows the invite again", async () => {
    const server = await factories.server({ maxUses: 1 });
    const member = await factories.member(server);

    const result = await redemption.redeem(server.inviteCode, member.id);

    expect(result.memberId).toBe(member.memberId);
    expect(await usesOf(server)).toBe(0);
  });
});
