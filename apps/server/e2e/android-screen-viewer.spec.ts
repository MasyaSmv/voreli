import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_EVERYONE_PERMISSIONS } from "@voreli/shared";
import argon2 from "argon2";

import { AndroidChrome } from "./support/android-chrome.js";

const enabled = process.env["ANDROID_VIEWER_E2E"] === "1";
const prisma = new PrismaClient();
const password = "android viewer password";
const suffix = randomUUID().slice(0, 8);
const demonstratorUsername = `android-demonstrator-${suffix}`;
const viewerUsername = `android-viewer-${suffix}`;
const userIds: string[] = [];
let serverId: string;
let demonstratorId: string;

test.describe("Android screen-share viewer", () => {
  test.skip(!enabled, "ANDROID_VIEWER_E2E=1 and a running Windows AVD are required");

  test.beforeAll(async () => {
    const passwordHash = await argon2.hash(password);
    demonstratorId = randomUUID();
    const viewerId = randomUUID();
    serverId = randomUUID();
    const roleId = randomUUID();
    userIds.push(demonstratorId, viewerId);

    await prisma.server.create({
      data: {
        id: serverId,
        name: "Voice Android e2e",
        owner: {
          create: {
            id: demonstratorId,
            username: demonstratorUsername,
            displayName: "Android demonstrator",
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
            { id: randomUUID(), name: "general", type: "TEXT", position: 0 },
            { id: randomUUID(), name: "Голосовой", type: "VOICE", position: 1 },
          ],
        },
        members: {
          create: {
            id: randomUUID(),
            userId: demonstratorId,
            roles: { create: { roleId } },
          },
        },
      },
    });
    await prisma.user.create({
      data: { id: viewerId, username: viewerUsername, displayName: "Android viewer", passwordHash },
    });
    await prisma.member.create({
      data: {
        id: randomUUID(),
        serverId,
        userId: viewerId,
        roles: { create: { roleId } },
      },
    });
  });

  test.afterAll(async () => {
    if (!enabled) return;
    await prisma.server.delete({ where: { id: serverId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  test("receives selective screen RTP across orientation and detaches the viewer", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(120_000);
    const desktopContext = await browser.newContext({
      locale: "ru-RU",
      permissions: ["microphone"],
      extraHTTPHeaders: { "X-Forwarded-For": `2001:db8::${suffix.slice(0, 4)}:31` },
    });
    const desktop = await desktopContext.newPage();
    const reversePorts = [5174, ...Array.from({ length: 11 }, (_, index) => 41_000 + index)];
    const android = await AndroidChrome.connect({
      origin: "http://localhost:5174",
      reversePorts,
    });

    try {
      await android.prepare();
      await Promise.all([
        login(desktop, demonstratorUsername),
        android.login(viewerUsername, password),
      ]);

      await desktop.getByRole("button", { name: "Голосовой", exact: true }).click();
      await desktop.getByRole("button", { name: "Подключиться" }).click();
      await expect(desktop.getByText("Голос подключён")).toBeVisible();

      await android.clickButton("Голосовой");
      await android.clickButton("Подключиться");
      await android.allowMicrophonePrompt();
      await android.waitForText("Голос подключён");

      await desktop.getByRole("button", { name: "Показать экран" }).click();
      const shareLabel = `Экран участника ${demonstratorId.slice(0, 6)}`;
      await android.waitForText(shareLabel);
      await expect(android.videoCount()).resolves.toBe(0);
      await expect(android.inboundVideoStats()).resolves.toMatchObject({ bytesReceived: 0 });

      await android.clickButton("Смотреть");
      await android.waitForLiveVideo();
      const initialStats = await android.inboundVideoStats();
      expect(initialStats.bytesReceived).toBeGreaterThan(0);
      expect(initialStats.framesDecoded).toBeGreaterThan(0);
      expect(initialStats.frameWidth).toBeLessThanOrEqual(480);

      await android.rotateLandscape();
      const landscapeViewport = await android.viewport();
      expect(landscapeViewport.width).toBeGreaterThan(landscapeViewport.height);
      await expect
        .poll(async () => (await android.inboundVideoStats()).framesDecoded, { timeout: 20_000 })
        .toBeGreaterThan(initialStats.framesDecoded);

      await android.rotatePortrait();
      const portraitViewport = await android.viewport();
      expect(portraitViewport.height).toBeGreaterThan(portraitViewport.width);

      await android.clickButton("Открепить");
      await expect.poll(() => android.detachedViewerIsActive()).toBe(true);
      const expandedStats = await android.inboundVideoStats();
      await expect
        .poll(async () => (await android.inboundVideoStats()).bytesReceived, { timeout: 20_000 })
        .toBeGreaterThan(expandedStats.bytesReceived);

      await testInfo.attach("android-screen-viewer", {
        body: JSON.stringify(
          { initialStats, expandedStats, landscapeViewport, portraitViewport },
          null,
          2,
        ),
        contentType: "application/json",
      });

      await desktop.getByRole("button", { name: "Остановить показ" }).click();
      await expect.poll(() => android.videoCount()).toBe(0);
      await android.waitForText("Голос подключён");
    } finally {
      await android.rotatePortrait().catch(() => undefined);
      await android.close();
      await desktopContext.close();
    }
  });
});

async function login(page: Page, username: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Имя пользователя").fill(username);
  await page.getByLabel("Пароль").fill(password);
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.url().endsWith("/auth/login")),
    page.getByRole("button", { name: "Войти" }).click(),
  ]);
  expect(response.status(), await response.text()).toBe(200);
  await expect(page.getByRole("heading", { name: "Voice Android e2e" })).toBeVisible();
}
