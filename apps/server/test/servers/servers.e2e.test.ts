import { Permission, serializePermissions } from "@voreli/shared";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Factories, type SeededUser } from "../support/factories.js";
import { createTestApp, type TestApp } from "../support/test-app.js";

describe("servers, channels and permissions", () => {
  let harness: TestApp;
  let factories: Factories;
  let owner: SeededUser;
  let ownerToken: string;
  let serverId: string;

  beforeAll(async () => {
    harness = await createTestApp();
    factories = new Factories(harness.prisma);
  });

  afterAll(async () => {
    await harness.close();
  });

  const http = () => request(harness.app.getHttpServer());

  async function tokenFor(user: SeededUser): Promise<string> {
    const response = await http()
      .post("/auth/login")
      .send({ username: user.username, password: user.password })
      .expect(200);

    return response.body.accessToken as string;
  }

  /** Registers a fresh account through the invite of the seeded server. */
  async function joinAsNewMember(): Promise<{ token: string; memberId: string; userId: string }> {
    const invite = await http()
      .post(`/servers/${serverId}/invites`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({})
      .expect(201);

    const registration = await http()
      .post("/auth/register")
      .send({
        inviteCode: invite.body.code,
        username: `member${Math.random().toString(36).slice(2, 9)}`,
        password: "long enough password",
      })
      .expect(201);

    const member = await harness.prisma.db.member.findFirstOrThrow({
      where: { serverId, userId: registration.body.user.id },
    });

    return {
      token: registration.body.accessToken as string,
      memberId: member.id,
      userId: registration.body.user.id as string,
    };
  }

  beforeEach(async () => {
    await harness.beginTransaction();

    const seeded = await factories.server();
    owner = { id: seeded.ownerId, username: "", password: "", memberId: "" };
    const ownerUser = await harness.prisma.db.user.findUniqueOrThrow({
      where: { id: seeded.ownerId },
    });
    owner = {
      id: ownerUser.id,
      username: ownerUser.username,
      password: "correct horse battery",
      memberId: "",
    };
    ownerToken = await tokenFor(owner);

    const created = await http()
      .post("/servers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Test server" })
      .expect(201);

    serverId = created.body.id as string;
  });

  afterEach(async () => {
    await harness.rollbackTransaction();
  });

  it("creates a server with @everyone, the owner as a member and starter channels", async () => {
    const view = await http()
      .get(`/servers/${serverId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);

    expect(view.body.isOwner).toBe(true);
    expect(view.body.roles.filter((role: { isDefault: boolean }) => role.isDefault)).toHaveLength(1);
    expect(view.body.categories).toHaveLength(1);
    expect(view.body.channels).toHaveLength(2);
    expect(view.body.channels.map((channel: { type: string }) => channel.type).sort()).toEqual([
      "TEXT",
      "VOICE",
    ]);
  });

  it("hides the server from someone who is not a member", async () => {
    const outsider = await factories.outsider();
    const token = await tokenFor(outsider);

    await http().get(`/servers/${serverId}`).set("Authorization", `Bearer ${token}`).expect(404);
  });

  it("lets the owner create a channel and refuses a plain member", async () => {
    const member = await joinAsNewMember();

    await http()
      .post(`/servers/${serverId}/channels`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "planning", type: "TEXT" })
      .expect(201);

    const refused = await http()
      .post(`/servers/${serverId}/channels`)
      .set("Authorization", `Bearer ${member.token}`)
      .send({ name: "sneaky", type: "TEXT" })
      .expect(403);

    expect(refused.body.errorCode).toBe("MISSING_PERMISSION");
  });

  it("removes a channel from the list when ViewChannel is denied for the member", async () => {
    const member = await joinAsNewMember();

    const before = await http()
      .get(`/servers/${serverId}`)
      .set("Authorization", `Bearer ${member.token}`)
      .expect(200);

    const target = before.body.channels[0] as { id: string };

    await http()
      .put(`/channels/${target.id}/overrides`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        memberId: member.memberId,
        allow: "0",
        deny: serializePermissions(Permission.ViewChannel),
      })
      .expect(204);

    const after = await http()
      .get(`/servers/${serverId}`)
      .set("Authorization", `Bearer ${member.token}`)
      .expect(200);

    expect(after.body.channels).toHaveLength(before.body.channels.length - 1);
    expect(after.body.channels.map((c: { id: string }) => c.id)).not.toContain(target.id);
  });

  it("answers 404, not 403, for a channel the member may not see", async () => {
    const member = await joinAsNewMember();

    const view = await http()
      .get(`/servers/${serverId}`)
      .set("Authorization", `Bearer ${member.token}`)
      .expect(200);

    const target = view.body.channels[0] as { id: string };

    await http()
      .put(`/channels/${target.id}/overrides`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        memberId: member.memberId,
        allow: "0",
        deny: serializePermissions(Permission.ViewChannel),
      })
      .expect(204);

    const denied = await http()
      .patch(`/channels/${target.id}`)
      .set("Authorization", `Bearer ${member.token}`)
      .send({ name: "renamed" })
      .expect(404);

    expect(denied.body.errorCode).toBe("NOT_FOUND");
  });

  it("restores access when a role override allows what @everyone denies", async () => {
    const member = await joinAsNewMember();
    const view = await http()
      .get(`/servers/${serverId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);

    const channelId = (view.body.channels[0] as { id: string }).id;
    const everyoneRole = (view.body.roles as { id: string; isDefault: boolean }[]).find(
      (role) => role.isDefault,
    );

    const role = await http()
      .post(`/servers/${serverId}/roles`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "trusted", permissions: "0" })
      .expect(201);

    await http()
      .put(`/members/${member.memberId}/roles/${role.body.id}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(204);

    await http()
      .put(`/channels/${channelId}/overrides`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        roleId: everyoneRole?.id,
        allow: "0",
        deny: serializePermissions(Permission.ViewChannel),
      })
      .expect(204);

    const hidden = await http()
      .get(`/servers/${serverId}`)
      .set("Authorization", `Bearer ${member.token}`)
      .expect(200);

    expect(hidden.body.channels.map((c: { id: string }) => c.id)).not.toContain(channelId);

    await http()
      .put(`/channels/${channelId}/overrides`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        roleId: role.body.id,
        allow: serializePermissions(Permission.ViewChannel),
        deny: "0",
      })
      .expect(204);

    const restored = await http()
      .get(`/servers/${serverId}`)
      .set("Authorization", `Bearer ${member.token}`)
      .expect(200);

    expect(restored.body.channels.map((c: { id: string }) => c.id)).toContain(channelId);
  });

  it("refuses to delete the @everyone role", async () => {
    const view = await http()
      .get(`/servers/${serverId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);

    const everyone = (view.body.roles as { id: string; isDefault: boolean }[]).find(
      (role) => role.isDefault,
    );

    const refused = await http()
      .delete(`/roles/${everyone?.id}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(409);

    expect(refused.body.errorCode).toBe("DEFAULT_ROLE_IMMUTABLE");
  });

  it("refuses to grant permissions the caller does not hold", async () => {
    const member = await joinAsNewMember();

    const manager = await http()
      .post(`/servers/${serverId}/roles`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "manager", permissions: serializePermissions(Permission.ManageRoles) })
      .expect(201);

    await http()
      .put(`/members/${member.memberId}/roles/${manager.body.id}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(204);

    // The member may manage roles, but holds neither Administrator nor BanMembers.
    const refused = await http()
      .post(`/servers/${serverId}/roles`)
      .set("Authorization", `Bearer ${member.token}`)
      .send({ name: "godmode", permissions: serializePermissions(Permission.Administrator) })
      .expect(403);

    expect(refused.body.errorCode).toBe("PERMISSION_ESCALATION");
  });

  it("lets only the owner delete the server", async () => {
    const member = await joinAsNewMember();

    const admin = await http()
      .post(`/servers/${serverId}/roles`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "admin", permissions: serializePermissions(Permission.Administrator) })
      .expect(201);

    await http()
      .put(`/members/${member.memberId}/roles/${admin.body.id}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(204);

    const refused = await http()
      .delete(`/servers/${serverId}`)
      .set("Authorization", `Bearer ${member.token}`)
      .expect(403);

    expect(refused.body.errorCode).toBe("OWNER_ONLY");

    await http()
      .delete(`/servers/${serverId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(204);
  });

  it("stops working once the invite is revoked", async () => {
    const invite = await http()
      .post(`/servers/${serverId}/invites`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({})
      .expect(201);

    await http()
      .delete(`/invites/${invite.body.code}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(204);

    const outsider = await factories.outsider();
    const token = await tokenFor(outsider);

    await http()
      .post(`/invites/${invite.body.code}/join`)
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
  });

  it("joins an already registered user through an invite", async () => {
    const invite = await http()
      .post(`/servers/${serverId}/invites`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({})
      .expect(201);

    const outsider = await factories.outsider();
    const token = await tokenFor(outsider);

    const joined = await http()
      .post(`/invites/${invite.body.code}/join`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(joined.body.server.id).toBe(serverId);

    const membership = await harness.prisma.db.member.findFirstOrThrow({
      where: { serverId, userId: outsider.id },
      include: { roles: { include: { role: true } } },
    });

    expect(membership.roles).toHaveLength(1);
    expect(membership.roles[0]?.role.isDefault).toBe(true);
  });
});
