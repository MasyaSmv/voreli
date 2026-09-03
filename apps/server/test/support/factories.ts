import { createId } from "@paralleldrive/cuid2";
import { DEFAULT_EVERYONE_PERMISSIONS, type PublicUser } from "@voreli/shared";
import argon2 from "argon2";

import type { PrismaService } from "../../src/infra/database/prisma.service.js";

export interface SeededServer {
  readonly serverId: string;
  readonly ownerId: string;
  readonly everyoneRoleId: string;
  readonly inviteCode: string;
}

export interface SeededUser {
  readonly id: string;
  readonly username: string;
  readonly password: string;
  readonly memberId: string;
}

/**
 * Builds the smallest valid world: a server, its owner, its @everyone role and an invite.
 *
 * Every user these factories create ends up holding a role, because a member without one is
 * not a valid domain object — permission resolution starts at @everyone — and a test built
 * on an invalid object proves nothing.
 */
export class Factories {
  constructor(private readonly prisma: PrismaService) {}

  async server(options: { maxUses?: number; expiresAt?: Date } = {}): Promise<SeededServer> {
    const owner = await this.rawUser("owner");
    const serverId = createId();
    const everyoneRoleId = createId();
    const inviteCode = `inv-${createId().slice(0, 10)}`;

    await this.prisma.db.server.create({
      data: { id: serverId, name: "Test server", ownerId: owner.id },
    });

    await this.prisma.db.role.create({
      data: {
        id: everyoneRoleId,
        serverId,
        name: "@everyone",
        isDefault: true,
        permissions: DEFAULT_EVERYONE_PERMISSIONS,
      },
    });

    await this.prisma.db.member.create({
      data: {
        id: createId(),
        serverId,
        userId: owner.id,
        roles: { create: { roleId: everyoneRoleId } },
      },
    });

    await this.prisma.db.invite.create({
      data: {
        id: createId(),
        code: inviteCode,
        serverId,
        createdById: owner.id,
        maxUses: options.maxUses ?? null,
        expiresAt: options.expiresAt ?? null,
      },
    });

    return { serverId, ownerId: owner.id, everyoneRoleId, inviteCode };
  }

  /** A registered member of `server`, ready to log in with the returned password. */
  async member(server: SeededServer, password = "correct horse battery"): Promise<SeededUser> {
    const user = await this.rawUser("member", password);
    const memberId = createId();

    await this.prisma.db.member.create({
      data: {
        id: memberId,
        serverId: server.serverId,
        userId: user.id,
        roles: { create: { roleId: server.everyoneRoleId } },
      },
    });

    return { id: user.id, username: user.username, password, memberId };
  }

  /** A user with no membership anywhere, for testing what outsiders can see. */
  async outsider(password = "correct horse battery"): Promise<SeededUser> {
    const user = await this.rawUser("outsider", password);

    return { id: user.id, username: user.username, password, memberId: "" };
  }

  private async rawUser(
    prefix: string,
    password = "correct horse battery",
  ): Promise<{ id: string; username: string }> {
    const id = createId();
    const username = `${prefix}-${id.slice(0, 8)}`;

    await this.prisma.db.user.create({
      data: {
        id,
        username,
        displayName: username,
        passwordHash: await argon2.hash(password),
      },
    });

    return { id, username };
  }
}

export function isPublicUser(value: unknown): value is PublicUser {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate["id"] === "string" &&
    typeof candidate["username"] === "string" &&
    typeof candidate["displayName"] === "string" &&
    typeof candidate["createdAt"] === "string" &&
    !("passwordHash" in candidate) &&
    !("password" in candidate)
  );
}
