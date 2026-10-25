import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_EVERYONE_PERMISSIONS } from "@voreli/shared";
import argon2 from "argon2";
import sharp from "sharp";

import { AndroidChrome } from "./support/android-chrome.js";
import { disposeUploadFixtures } from "./support/upload-fixtures.js";
import { voiceContext } from "./support/voice-browser.js";

const enabled = process.env["ANDROID_VIEWER_E2E"] === "1";
const prisma = new PrismaClient();
const password = "android viewer password";
const suffix = randomUUID().slice(0, 8);
const demonstratorUsername = `android-demonstrator-${suffix}`;
const viewerUsername = `android-viewer-${suffix}`;
const androidOrigin = "http://127.0.0.1:5174";
const reversePorts = [5174, 20_000, 9000];
const userIds: string[] = [];
let serverId: string;
let demonstratorId: string;

test.describe("Android Chrome media and chat", () => {
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
    const [userLowId, userHighId] = [demonstratorId, viewerId].sort();
    if (!userLowId || !userHighId) throw new Error("Android test users were not created");
    await prisma.directConversation.create({
      data: { id: randomUUID(), userLowId, userHighId },
    });
  });

  test.afterAll(async () => {
    if (!enabled) return;
    await disposeUploadFixtures(prisma, userIds);
    await prisma.directConversation.deleteMany({
      where: { OR: [{ userLowId: { in: userIds } }, { userHighId: { in: userIds } }] },
    });
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
    const android = await AndroidChrome.connect({
      origin: androidOrigin,
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
      await expect
        .poll(async () => (await android.inboundVideoStats()).frameWidth, { timeout: 20_000 })
        .toBeLessThanOrEqual(480);

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

  test("answers a direct call and receives audio and camera video in Android Chrome", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(120_000);
    const desktopContext = await voiceContext(browser, `2001:db8::${suffix.slice(0, 4)}:32`);
    await desktopContext.grantPermissions(["microphone", "camera"]);
    const desktop = await desktopContext.newPage();
    const android = await AndroidChrome.connect({
      origin: androidOrigin,
      reversePorts,
    });

    try {
      await android.prepare();
      await Promise.all([
        login(desktop, demonstratorUsername),
        android.login(viewerUsername, password),
      ]);
      await desktop.getByRole("button", { name: "Главная Voreli" }).click();
      await desktop
        .getByRole("button", { name: new RegExp(`Android viewer.*@${viewerUsername}`) })
        .click();
      await desktop.getByRole("button", { name: "Позвонить Android viewer" }).click();
      await android.waitForText("Входящий звонок");
      await android.clickButton("Принять звонок");
      await android.allowMicrophonePrompt();
      await android.waitForText("Разговор идёт");
      await expect(desktop.getByText("Разговор идёт")).toBeVisible();
      await expect.poll(() => desktop.locator("audio").count()).toBe(1);
      await expect.poll(() => android.inboundAudioBytes(), { timeout: 20_000 }).toBeGreaterThan(0);
      await android.waitForLiveAudio();

      await desktop.getByRole("button", { name: "Включить камеру" }).click();
      await android.waitForLiveVideo();
      const initialVideo = await android.inboundVideoStats();
      expect(initialVideo.framesDecoded).toBeGreaterThan(0);
      const initialAudio = await android.inboundAudioBytes();
      await expect.poll(() => android.inboundAudioBytes()).toBeGreaterThan(initialAudio);
      await android.waitForLiveAudio();
      await testInfo.attach("android-direct-call", {
        body: JSON.stringify({ initialAudio, initialVideo }, null, 2),
        contentType: "application/json",
      });

      await desktop.getByRole("button", { name: "Завершить звонок" }).click();
      await android.waitForNoText("Разговор идёт");
    } finally {
      await android.close();
      await desktopContext.close();
    }
  });

  test("sends, edits, replies to and deletes a channel message, then sends a photo from Android Chrome", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const desktopContext = await browser.newContext({ locale: "ru-RU" });
    const desktop = await desktopContext.newPage();
    const android = await AndroidChrome.connect({
      origin: androidOrigin,
      reversePorts,
    });

    try {
      await android.prepare();
      await Promise.all([
        login(desktop, demonstratorUsername),
        android.login(viewerUsername, password),
      ]);
      await desktop.getByRole("button", { name: "general", exact: true }).click();
      await android.waitForText("Текстовый канал");

      const message = `Android message ${suffix}`;
      await android.fillInput("#message-draft", message);
      await android.clickButton("Отправить сообщение");
      await expect(desktop.getByText(message, { exact: true })).toBeVisible();
      const originalRow = desktop.locator('li[id^="message-"]').filter({ hasText: message });
      const messageId = await originalRow.getAttribute("id");
      if (!messageId) throw new Error("The Android message has no server ID");
      const originalById = desktop.locator(`#${messageId}`);

      const editedMessage = `${message} edited`;
      await android.clickMessageButton(messageId, "Редактировать");
      await android.fillInput(
        `#${messageId} input[aria-label="Редактировать сообщение"]`,
        editedMessage,
      );
      await android.clickMessageButton(messageId, "Сохранить");
      await expect(originalById.getByText(editedMessage, { exact: true })).toBeVisible();

      await android.clickMessageButton(messageId, "Ответить");
      const replyText = `Android reply ${suffix}`;
      await android.fillInput("#message-draft", replyText);
      await android.clickButton("Отправить сообщение");
      const replyRow = desktop.locator('li[id^="message-"]').filter({ hasText: replyText });
      await expect(replyRow.getByText(replyText, { exact: true })).toBeVisible();
      await expect(replyRow.getByRole("button", { name: new RegExp(editedMessage) })).toBeVisible();

      await android.clickMessageButton(messageId, "Удалить");
      await expect(originalById.getByText("Сообщение удалено", { exact: true })).toBeVisible();
      await expect(replyRow.getByRole("button", { name: /Сообщение удалено/ })).toBeVisible();

      const image = await sharp({
        create: { width: 16, height: 16, channels: 3, background: "red" },
      })
        .png()
        .toBuffer();
      await android.selectFile("avd-photo.png", "image/png", image.toString("base64"));
      await android.waitForText("Готово", 30_000);
      await android.clickButton("Отправить сообщение");
      await android.waitForMessageImage();
      const photoRow = desktop.locator('li[id^="message-"]').filter({ hasText: "avd-photo.png" });
      await expect(photoRow.locator("img")).toBeVisible();
      await desktop.reload();
      await desktop.getByRole("button", { name: "general", exact: true }).click();
      await expect(photoRow.locator("img")).toBeVisible();
      await expect(originalById.getByText("Сообщение удалено", { exact: true })).toBeVisible();
      await expect(replyRow.getByRole("button", { name: /Сообщение удалено/ })).toBeVisible();
    } finally {
      await android.close();
      await desktopContext.close();
    }
  });

  test("sends a gallery photo through the native Android picker", async ({ browser }) => {
    test.setTimeout(120_000);
    const filename = "voreli-avd-gallery.png";
    const localPath = `/tmp/${filename}`;
    const android = await AndroidChrome.connect({ origin: androidOrigin, reversePorts });
    let desktopContext: BrowserContext | undefined;
    let photoWritten = false;
    let cleanupFailure: unknown;
    try {
      const image = await sharp({
        create: { width: 64, height: 64, channels: 3, background: "red" },
      })
        .png()
        .toBuffer();
      await writeFile(localPath, image);
      photoWritten = true;
      desktopContext = await browser.newContext({ locale: "ru-RU" });
      const desktop = await desktopContext.newPage();
      await android.addGalleryPhoto(localPath, filename);
      await android.prepare();
      await Promise.all([
        login(desktop, demonstratorUsername),
        android.login(viewerUsername, password),
      ]);
      await desktop.getByRole("button", { name: "general", exact: true }).click();
      await android.waitForText("Текстовый канал");
      await android.openNativeFilePicker();
      if ((await android.nativeUiSummary()).includes("permission_allow_foreground_only_button")) {
        await android.tapNativeControl("permission_allow_foreground_only_button");
      }
      await android.tapNativeControl("Files");
      await android.tapNativeControl("Photos");
      await android.tapNativeControl("Pictures");
      await android.tapNativeControl("Select");
      await android.tapNativeControl("Done");
      await android.waitForText("Готово", 30_000);
      await android.clickButton("Отправить сообщение");
      const photoRow = desktop.locator('li[id^="message-"]').filter({ hasText: filename });
      await expect(photoRow.locator("img")).toBeVisible();
      await expect(photoRow.locator("img")).toHaveJSProperty("naturalWidth", 64);
      await desktop.reload();
      await desktop.getByRole("button", { name: "general", exact: true }).click();
      await expect(photoRow.locator("img")).toBeVisible();
      await expect(photoRow.locator("img")).toHaveJSProperty("naturalWidth", 64);
    } finally {
      const cleanup = await Promise.allSettled([
        android.removeGalleryPhoto(filename),
        android.close(),
        desktopContext?.close(),
        photoWritten ? unlink(localPath) : undefined,
      ]);
      const failure = cleanup.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") cleanupFailure = failure.reason as unknown;
    }
    if (cleanupFailure !== undefined) {
      throw cleanupFailure instanceof Error
        ? cleanupFailure
        : new Error("Android fixture cleanup failed", { cause: cleanupFailure });
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
