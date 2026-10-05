import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

import {
  closeContext,
  mediaStats,
  voiceContext,
  waitForLiveAudio,
} from "./support/voice-browser.js";
import {
  aliceUsername,
  bobUsername,
  clientAddresses,
  disposeVoreliFixture,
  login,
  prisma,
  seedVoreliFixture,
} from "./support/voreli-fixture.js";

test.beforeAll(async () => {
  await seedVoreliFixture();
  const users = await prisma.user.findMany({
    where: { username: { in: [aliceUsername, bobUsername] } },
    select: { id: true, username: true },
  });
  const aliceId = users.find((user) => user.username === aliceUsername)?.id;
  const bobId = users.find((user) => user.username === bobUsername)?.id;
  if (!aliceId || !bobId) throw new Error("Direct-call users were not seeded");
  const userLowId = aliceId < bobId ? aliceId : bobId;
  const userHighId = aliceId < bobId ? bobId : aliceId;
  await prisma.directConversation.upsert({
    where: { userLowId_userHighId: { userLowId, userHighId } },
    create: { id: randomUUID(), userLowId, userHighId },
    update: {},
  });
});
test.afterAll(disposeVoreliFixture);

test("direct-call camera starts by choice, carries video both ways and stops independently of audio", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const aliceContext = await voiceContext(browser, clientAddresses.alice);
  const bobContext = await voiceContext(browser, clientAddresses.bob);
  await aliceContext.grantPermissions(["microphone", "camera"]);
  await bobContext.grantPermissions(["microphone", "camera"]);
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  await bob.setViewportSize({ width: 390, height: 844 });

  try {
    await login(alice, aliceUsername);
    await login(bob, bobUsername);
    await alice.getByRole("button", { name: "Главная Voreli" }).click();
    await bob.getByRole("button", { name: "Серверы", exact: true }).click();
    await bob.getByRole("button", { name: "Главная Voreli" }).click();
    await alice.getByRole("button", { name: new RegExp(`Bob.*@${bobUsername}`) }).click();
    await alice.getByRole("button", { name: "Позвонить Bob" }).click();
    await bob.getByRole("button", { name: "Принять звонок" }).click();
    await expect(alice.getByText("Разговор идёт")).toBeVisible();
    await expect(bob.getByText("Разговор идёт")).toBeVisible();
    await waitForLiveAudio(alice, 1);
    await waitForLiveAudio(bob, 1);
    for (const page of [alice, bob]) {
      expect(
        await page.evaluate(
          () =>
            (window as Window & { __capturedCameraTracks?: MediaStreamTrack[] })
              .__capturedCameraTracks?.length ?? 0,
        ),
      ).toBe(0);
    }

    await alice.getByRole("button", { name: "Включить камеру" }).click();
    await bob.getByRole("button", { name: "Включить камеру" }).click();
    for (const page of [alice, bob]) {
      await expect(page.getByLabel("Предпросмотр своей камеры")).toBeVisible();
      await expect
        .poll(async () =>
          page
            .getByLabel("Предпросмотр своей камеры")
            .evaluate((video: HTMLVideoElement) => video.videoWidth),
        )
        .toBeGreaterThan(0);
      await expect
        .poll(async () => (await mediaStats(page, "inbound-rtp", "video")).framesDecoded, {
          timeout: 20_000,
        })
        .toBeGreaterThan(0);
    }
    await alice.getByRole("button", { name: "Выключить камеру" }).click();
    await expect(bob.getByLabel("Камера Alice")).not.toBeVisible();
    await waitForLiveAudio(alice, 1);
    await waitForLiveAudio(bob, 1);
    await alice.getByRole("button", { name: "Включить камеру" }).click();
    await expect
      .poll(async () => (await mediaStats(bob, "inbound-rtp", "video")).framesDecoded)
      .toBeGreaterThan(0);
    await bob.setViewportSize({ width: 844, height: 390 });
    await expect
      .poll(async () =>
        bob.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      )
      .toBe(true);
    await bobContext.setOffline(true);
    await expect(alice.getByText("Восстанавливаем соединение…")).toBeVisible({ timeout: 20_000 });
    await expect(bob.getByRole("button", { name: "Включить камеру" })).toBeVisible();
    await bobContext.setOffline(false);
    await waitForLiveAudio(bob, 1);
    await expect(alice.getByLabel("Камера Bob")).not.toBeVisible();
    await alice.getByRole("button", { name: "Завершить звонок" }).click();
    for (const page of [alice, bob]) {
      await expect
        .poll(async () =>
          page.evaluate(() =>
            (
              window as Window & { __capturedCameraTracks?: MediaStreamTrack[] }
            ).__capturedCameraTracks?.every((track) => track.readyState === "ended"),
          ),
        )
        .toBe(true);
    }
  } finally {
    await closeContext(aliceContext);
    await closeContext(bobContext);
  }
});
