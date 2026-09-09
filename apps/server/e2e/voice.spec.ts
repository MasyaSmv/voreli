import { randomUUID } from "node:crypto";

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { ContactAudience, DEFAULT_EVERYONE_PERMISSIONS } from "@voreli/shared";
import argon2 from "argon2";

const prisma = new PrismaClient();
const password = "playwright voice password";
const suffix = randomUUID().slice(0, 8);
const aliceUsername = `voice-alice-${suffix}`;
const bobUsername = `voice-bob-${suffix}`;
const charlieUsername = `voice-charlie-${suffix}`;
const clientAddresses = {
  alice: `2001:db8::${suffix.slice(0, 4)}:1`,
  bob: `2001:db8::${suffix.slice(0, 4)}:2`,
  charlie: `2001:db8::${suffix.slice(0, 4)}:3`,
  invalidLogin: `2001:db8::${suffix.slice(0, 4)}:4`,
};
const userIds: string[] = [];
let serverId: string;
const textChannelName = "general";

test.beforeAll(async () => {
  const passwordHash = await argon2.hash(password);
  const aliceId = randomUUID();
  const bobId = randomUUID();
  const charlieId = randomUUID();
  userIds.push(aliceId, bobId, charlieId);
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
  await prisma.member.create({
    data: {
      id: randomUUID(),
      serverId,
      userId: aliceId,
      roles: { create: { roleId } },
    },
  });
  await prisma.member.create({
    data: {
      id: randomUUID(),
      serverId,
      userId: charlieId,
      roles: { create: { roleId } },
    },
  });
  await prisma.member.create({
    data: {
      id: randomUUID(),
      serverId,
      userId: bobId,
      roles: { create: { roleId } },
    },
  });
});

test.afterAll(async () => {
  await prisma.server.delete({ where: { id: serverId } });
  await prisma.directConversation.deleteMany({
    where: { OR: [{ userLowId: { in: userIds } }, { userHighId: { in: userIds } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

test("login exposes its pending and error states", async ({ browser }) => {
  const context = await browser.newContext({
    locale: "ru-RU",
    reducedMotion: "reduce",
    extraHTTPHeaders: { "X-Forwarded-For": clientAddresses.invalidLogin },
  });
  const page = await context.newPage();

  try {
    await page.route("**/auth/login", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.continue();
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Войдите в Voreli" })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Русский" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "English" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Имя пользователя")).toBeFocused();
    await page.getByLabel("Имя пользователя").fill(aliceUsername);
    await page.getByLabel("Пароль").fill("incorrect password");
    await page.getByRole("button", { name: "Войти" }).click();

    await expect(page.getByRole("button", { name: "Подождите…" })).toBeDisabled();
    await expect(page.getByRole("alert")).toHaveText("Неверное имя или пароль");
  } finally {
    await closeContext(context);
  }
});

test("session survives reload and an expired cookie returns to login", async ({ browser }) => {
  const context = await browser.newContext({
    locale: "ru-RU",
    extraHTTPHeaders: { "X-Forwarded-For": clientAddresses.alice },
  });
  const page = await context.newPage();
  let refreshRequests = 0;

  try {
    await page.route("**/auth/refresh", async (route) => {
      refreshRequests += 1;
      await route.continue();
    });
    await login(page, aliceUsername);
    refreshRequests = 0;

    await page.reload();

    await expect(page.getByRole("heading", { name: "Voice e2e" })).toBeVisible();
    expect(refreshRequests).toBe(1);

    await context.clearCookies();
    await page.reload();

    await expect(page.getByRole("heading", { name: "Войдите в Voreli" })).toBeVisible();
  } finally {
    await closeContext(context);
  }
});

test("workspace home, channel creation, settings and message dates are interactive", async ({
  browser,
}) => {
  const context = await browser.newContext({
    locale: "ru-RU",
    extraHTTPHeaders: { "X-Forwarded-For": clientAddresses.alice },
  });
  const page = await context.newPage();
  const channelName = `заметки-${suffix}`;

  try {
    await login(page, aliceUsername);

    await page.getByRole("button", { name: "Главная Voreli" }).click();
    await expect(page.getByRole("heading", { name: "Ваши пространства" })).toBeVisible();
    await page.getByRole("button", { name: "Voice e2e Открыть сервер" }).click();

    await page.getByRole("button", { name: "Меню сервера Voice e2e" }).click();
    await page.getByRole("button", { name: "Создать канал" }).click();
    await page.getByLabel("Название").fill(channelName);
    const [created] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith(`/servers/${serverId}/channels`) &&
          response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Создать", exact: true }).click(),
    ]);
    expect(created.status(), await created.text()).toBe(201);
    await expect(page.getByRole("heading", { name: channelName, exact: true })).toBeVisible();

    await page.getByLabel(`Сообщение в канале ${channelName}`).fill("Сообщение с датой");
    await page.getByRole("button", { name: "Отправить сообщение" }).click();
    await expect(page.getByRole("separator")).toBeVisible();

    await page.getByRole("button", { name: "Открыть профиль и настройки" }).click();
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  } finally {
    await closeContext(context);
  }
});

test("relationship flow keeps a revoked DM as read-only history", async ({ browser }) => {
  const aliceContext = await browser.newContext({
    locale: "ru-RU",
    extraHTTPHeaders: { "X-Forwarded-For": clientAddresses.alice },
  });
  const bobContext = await browser.newContext({
    locale: "ru-RU",
    extraHTTPHeaders: { "X-Forwarded-For": clientAddresses.bob },
  });
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  try {
    await login(alice, aliceUsername);
    await alice.getByRole("button", { name: "Главная Voreli" }).click();
    await alice.getByPlaceholder("@username").fill(`@${bobUsername}`);
    const [lookupResponse] = await Promise.all([
      alice.waitForResponse((response) => response.url().includes("/users/lookup?")),
      alice.getByRole("button", { name: "Найти" }).click(),
    ]);
    expect(lookupResponse.status(), await lookupResponse.text()).toBe(200);
    expect(await lookupResponse.json()).toMatchObject({ user: { username: bobUsername } });
    await expect(alice.getByText(`@${bobUsername}`, { exact: true })).toBeVisible();
    await alice.getByRole("button", { name: "Написать" }).click();
    await alice.getByLabel("Сообщение для Bob").fill("Личное сообщение без дружбы");
    await alice.getByRole("button", { name: "Отправить сообщение" }).click();
    await expect(alice.getByText("Личное сообщение без дружбы", { exact: true })).toBeVisible();

    await login(bob, bobUsername);
    await bob.getByRole("button", { name: "Главная Voreli" }).click();
    const aliceConversation = bob.getByRole("button", {
      name: new RegExp(`Alice.*@${aliceUsername}`),
    });
    await expect(aliceConversation.getByText("1", { exact: true })).toBeVisible();
    await aliceConversation.click();
    await expect(bob.getByText("Личное сообщение без дружбы", { exact: true })).toBeVisible();

    await bob.getByRole("button", { name: "Voice e2e", exact: true }).click();
    await bob.getByRole("button", { name: "Открыть профиль и настройки" }).click();
    const [closedMessages] = await Promise.all([
      bob.waitForResponse(
        (response) =>
          response.url().endsWith("/users/me/contact-settings") &&
          response.request().method() === "PATCH",
      ),
      bob.getByLabel("Сообщения").selectOption(ContactAudience.Nobody),
    ]);
    expect(await closedMessages.json()).toMatchObject({
      directMessageAudience: ContactAudience.Nobody,
      directCallAudience: ContactAudience.Everyone,
    });

    await expect(alice.getByRole("alert")).toHaveText("Адресат закрыл личные сообщения");
    await expect(alice.getByText("Личное сообщение без дружбы", { exact: true })).toBeVisible();
    await expect(alice.getByLabel("Сообщение для Bob")).toBeDisabled();

    await alice.getByRole("button", { name: "В друзья" }).click();
    await expect(alice.getByRole("heading", { name: "Исходящие заявки" })).toBeVisible();
    await alice.getByRole("button", { name: "Отменить" }).click();
    await expect(alice.getByRole("heading", { name: "Исходящие заявки" })).not.toBeVisible();

    await alice.getByRole("button", { name: "Найти" }).click();
    await alice.getByRole("button", { name: "В друзья" }).click();
    await expect(alice.getByRole("heading", { name: "Исходящие заявки" })).toBeVisible();

    await bob.getByRole("button", { name: "Закрыть", exact: true }).click();
    await bob.getByRole("button", { name: "Главная Voreli" }).click();
    await expect(bob.getByRole("heading", { name: "Входящие заявки" })).toBeVisible();
    await bob.getByRole("button", { name: "Отклонить" }).click();
    await expect(bob.getByRole("heading", { name: "Входящие заявки" })).not.toBeVisible();
    await expect(alice.getByRole("heading", { name: "Исходящие заявки" })).not.toBeVisible();

    await alice.getByRole("button", { name: "Найти" }).click();
    await alice.getByRole("button", { name: "В друзья" }).click();
    await expect(bob.getByRole("heading", { name: "Входящие заявки" })).toBeVisible();
    await bob.getByRole("button", { name: "Принять" }).click();
    await expect(alice.getByRole("button", { name: "Удалить из друзей" })).toBeVisible();

    await bob.getByRole("button", { name: "Voice e2e", exact: true }).click();
    await bob.getByRole("button", { name: "Открыть профиль и настройки" }).click();
    await bob.getByLabel("Сообщения").selectOption(ContactAudience.Friends);
    await bob.getByRole("button", { name: "Закрыть", exact: true }).click();

    await alice.getByRole("button", { name: "Voice e2e", exact: true }).click();
    await alice.getByRole("button", { name: "Главная Voreli" }).click();
    await alice.getByRole("button", { name: new RegExp(`Bob.*@${bobUsername}`) }).click();
    await expect(alice.getByText("Личное сообщение без дружбы", { exact: true })).toBeVisible();
    await expect(alice.getByLabel("Сообщение для Bob")).toBeEnabled();

    await alice.getByRole("button", { name: "Удалить из друзей" }).click();
    await expect(alice.getByRole("alert")).toHaveText("Адресат закрыл личные сообщения");
    await expect(alice.getByText("Личное сообщение без дружбы", { exact: true })).toBeVisible();
    await expect(alice.getByLabel("Сообщение для Bob")).toBeDisabled();
  } finally {
    await closeContext(aliceContext);
    await closeContext(bobContext);
  }
});

test("chat and voice work while three clients receive every remote track through the SFU", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const aliceContext = await voiceContext(browser, clientAddresses.alice);
  const bobContext = await voiceContext(browser, clientAddresses.bob);
  const charlieContext = await voiceContext(browser, clientAddresses.charlie);
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  const charlie = await charlieContext.newPage();

  try {
    await login(alice, aliceUsername);
    const message = `Browser smoke ${suffix}`;
    await alice
      .getByRole("textbox", { name: `Сообщение в канале ${textChannelName}` })
      .fill(message);
    await alice.getByRole("button", { name: "Отправить сообщение" }).click();
    await expect(alice.getByText(message)).toBeVisible();

    await alice.getByRole("button", { name: /Голосовой/ }).click();
    await expect(alice.getByText("Голос подключён")).toBeVisible();

    await alice.getByRole("button", { name: "Проверить эхо" }).click();
    await expect.poll(() => alice.locator("audio").count()).toBe(1);
    await waitForLiveAudio(alice, 1);

    await login(bob, bobUsername);
    await bob.getByRole("button", { name: /Голосовой/ }).click();
    await expect(bob.getByText("Голос подключён")).toBeVisible();

    await expect.poll(() => bob.locator("audio").count()).toBe(1);
    await expect.poll(() => alice.locator("audio").count()).toBe(2);
    await waitForLiveAudio(bob, 1);
    await waitForLiveAudio(alice, 2);

    await alice.getByRole("button", { name: "Выключить микрофон" }).click();
    await expect(alice.getByRole("button", { name: "Включить микрофон" })).toBeVisible();
    await waitForInboundAudioToStop(bob);
    await alice.getByRole("button", { name: "Включить микрофон" }).click();
    await expect(alice.getByRole("button", { name: "Выключить микрофон" })).toBeVisible();
    await waitForInboundAudioToResume(bob);

    await bob.getByRole("button", { name: "Выключить звук" }).click();
    await waitForPausedPlayback(bob, 1);

    await login(charlie, charlieUsername);
    await charlie.getByRole("button", { name: /Голосовой/ }).click();
    await expect(charlie.getByText("Голос подключён")).toBeVisible();

    await waitForLiveAudio(charlie, 2);
    await waitForPausedPlayback(bob, 2);
    await waitForLiveAudio(alice, 3);

    await bob.getByRole("button", { name: "Включить звук" }).click();
    await waitForLiveAudio(bob, 2);

    await bobContext.setOffline(true);
    await expect(bob.getByText("Восстанавливаем соединение…")).toBeVisible({ timeout: 30_000 });
    await bobContext.setOffline(false);
    await expect(bob.getByText("Голос подключён")).toBeVisible({ timeout: 30_000 });
    await waitForInboundAudioToResume(bob);
  } finally {
    await closeContext(aliceContext);
    await closeContext(bobContext);
    await closeContext(charlieContext);
  }
});

async function login(page: Page, username: string): Promise<void> {
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

async function voiceContext(browser: Browser, clientAddress: string): Promise<BrowserContext> {
  const context = await browser.newContext({
    permissions: ["microphone"],
    locale: "ru-RU",
    extraHTTPHeaders: { "X-Forwarded-For": clientAddress },
  });
  await context.addInitScript(() => {
    const peerConnections: RTCPeerConnection[] = [];
    const NativePeerConnection = window.RTCPeerConnection;
    const instrumentedWindow = window as unknown as Window & {
      __voicePeerConnections: RTCPeerConnection[];
    };
    instrumentedWindow.__voicePeerConnections = peerConnections;
    window.RTCPeerConnection = class extends NativePeerConnection {
      constructor(configuration?: RTCConfiguration) {
        super(configuration);
        peerConnections.push(this);
      }
    };
  });
  return context;
}

async function waitForLiveAudio(page: Page, expectedTracks: number): Promise<void> {
  await page.waitForFunction(
    `Array.from(document.querySelectorAll("audio")).length === ${String(expectedTracks)} &&
    Array.from(document.querySelectorAll("audio")).every((element) => {
      const stream = element.srcObject;
      if (!(stream instanceof MediaStream)) return false;
      const track = stream.getAudioTracks()[0];
      return track !== undefined && track.readyState === "live" && !track.muted && !element.paused;
    })`,
    undefined,
    { timeout: 15_000 },
  );
}

async function waitForPausedPlayback(page: Page, expectedTracks: number): Promise<void> {
  await page.waitForFunction(
    `Array.from(document.querySelectorAll("audio")).length === ${String(expectedTracks)} &&
    Array.from(document.querySelectorAll("audio")).every((element) => element.paused)`,
    undefined,
    { timeout: 15_000 },
  );
}

async function waitForInboundAudioToStop(page: Page): Promise<void> {
  let previous = await inboundAudioBytes(page);
  await expect
    .poll(async () => {
      await page.waitForTimeout(500);
      const current = await inboundAudioBytes(page);
      const stopped = current === previous;
      previous = current;
      return stopped;
    })
    .toBe(true);
}

async function waitForInboundAudioToResume(page: Page): Promise<void> {
  const before = await inboundAudioBytes(page);
  await expect.poll(() => inboundAudioBytes(page)).toBeGreaterThan(before);
}

async function inboundAudioBytes(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const instrumentedWindow = window as Window & {
      __voicePeerConnections?: RTCPeerConnection[];
    };
    let bytes = 0;
    for (const peerConnection of instrumentedWindow.__voicePeerConnections ?? []) {
      const reports = await peerConnection.getStats();
      reports.forEach((report) => {
        if (report.type === "inbound-rtp" && report.kind === "audio") {
          bytes += Number(report.bytesReceived ?? 0);
        }
      });
    }
    return bytes;
  });
}

async function closeContext(context: BrowserContext): Promise<void> {
  await context.close();
}
