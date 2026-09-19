import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_EVERYONE_PERMISSIONS } from "@voreli/shared";
import argon2 from "argon2";

export const prisma = new PrismaClient();
export const password = "playwright voice password";
export const suffix = randomUUID().slice(0, 8);
export const aliceUsername = `voice-alice-${suffix}`;
export const bobUsername = `voice-bob-${suffix}`;
export const charlieUsername = `voice-charlie-${suffix}`;
export const screenViewerUsername = `voice-screen-viewer-${suffix}`;
export const clientAddresses = {
  alice: `2001:db8::${suffix.slice(0, 4)}:1`,
  bob: `2001:db8::${suffix.slice(0, 4)}:2`,
  bobSecond: `2001:db8::${suffix.slice(0, 4)}:5`,
  charlie: `2001:db8::${suffix.slice(0, 4)}:3`,
  invalidLogin: `2001:db8::${suffix.slice(0, 4)}:4`,
};
export const textChannelName = "general";

const userIds: string[] = [];
export let serverId = "";
export let aliceUserId = "";
export let bobUserId = "";

export async function seedVoreliFixture(): Promise<void> {
  const passwordHash = await argon2.hash(password);
  const aliceId = randomUUID();
  const bobId = randomUUID();
  const charlieId = randomUUID();
  const screenViewerId = randomUUID();
  aliceUserId = aliceId;
  bobUserId = bobId;
  userIds.push(aliceId, bobId, charlieId, screenViewerId);
  serverId = randomUUID();
  const roleId = randomUUID();

  await prisma.server.create({
    data: {
      id: serverId,
      name: "Voice e2e",
      owner: {
        create: {
          id: aliceId,
          username: aliceUsername,
          displayName: "Alice",
          passwordHash,
        },
      },
      roles: {
        create: {
          id: roleId,
          name: "@everyone",
          isDefault: true,
          permissions: DEFAULT_EVERYONE_PERMISSIONS,
        },
      },
      channels: {
        create: [
          { id: randomUUID(), name: textChannelName, type: "TEXT", position: 0 },
          { id: randomUUID(), name: "Голосовой", type: "VOICE", position: 1 },
        ],
      },
    },
  });
  await prisma.user.create({
    data: { id: bobId, username: bobUsername, displayName: "Bob", passwordHash },
  });
  await prisma.user.create({
    data: { id: charlieId, username: charlieUsername, displayName: "Charlie", passwordHash },
  });
  await prisma.user.create({
    data: {
      id: screenViewerId,
      username: screenViewerUsername,
      displayName: "Screen viewer",
      passwordHash,
    },
  });
  await Promise.all(
    [aliceId, bobId, charlieId, screenViewerId].map((userId) =>
      prisma.member.create({
        data: {
          id: randomUUID(),
          serverId,
          userId,
          roles: { create: { roleId } },
        },
      }),
    ),
  );
}

export async function disposeVoreliFixture(): Promise<void> {
  await prisma.server.delete({ where: { id: serverId } });
  await prisma.directConversation.deleteMany({
    where: { OR: [{ userLowId: { in: userIds } }, { userHighId: { in: userIds } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
}

export async function login(page: Page, username: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Имя").fill(username);
  await page.getByLabel("Пароль").fill(password);
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.url().endsWith("/auth/login")),
    page.getByRole("button", { name: "Войти" }).click(),
  ]);
  expect(response.status(), await response.text()).toBe(200);
  await expect(page.getByRole("heading", { name: "Voice e2e" })).toBeVisible();
}
