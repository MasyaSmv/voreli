import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  capturedTrackStates,
  closeContext,
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

test.beforeAll(seedVoreliFixture);
test.afterAll(disposeVoreliFixture);

test("direct call rings, carries RTP and resumes the same call after a network blackout", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const users = await prisma.user.findMany({
    where: { username: { in: [aliceUsername, bobUsername] } },
    select: { id: true, username: true },
  });
  const aliceId = users.find((user) => user.username === aliceUsername)?.id;
  const bobId = users.find((user) => user.username === bobUsername)?.id;
  if (!aliceId || !bobId) throw new Error("Direct-call users were not seeded");
  const userLowId = aliceId < bobId ? aliceId : bobId;
  const userHighId = aliceId < bobId ? bobId : aliceId;
  const conversation = await prisma.directConversation.upsert({
    where: { userLowId_userHighId: { userLowId, userHighId } },
    create: { id: randomUUID(), userLowId, userHighId },
    update: {},
  });

  const aliceContext = await voiceContext(browser, clientAddresses.alice);
  const bobContext = await voiceContext(browser, clientAddresses.bob);
  const bobSecondContext = await voiceContext(browser, clientAddresses.bobSecond);
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  const bobSecond = await bobSecondContext.newPage();
  await bob.setViewportSize({ width: 390, height: 844 });
  await bobSecond.setViewportSize({ width: 390, height: 844 });

  try {
    await login(alice, aliceUsername);
    await login(bob, bobUsername);
    await login(bobSecond, bobUsername);
    await alice.getByRole("button", { name: "Главная Voreli" }).click();
    await bob.getByRole("button", { name: "Главная Voreli" }).click();
    await bobSecond.getByRole("button", { name: "Главная Voreli" }).click();
    await alice.getByRole("button", { name: new RegExp(`Bob.*@${bobUsername}`) }).click();

    await alice.getByRole("button", { name: "Позвонить Bob" }).click();
    await expect(bob.getByText("Входящий звонок")).toBeVisible();
    await expect(bobSecond.getByText("Входящий звонок")).toBeVisible();
    await Promise.all([
      bob.getByRole("button", { name: "Принять звонок" }).click(),
      bobSecond.getByRole("button", { name: "Принять звонок" }).click(),
    ]);
    await expect(alice.getByText("Разговор идёт")).toBeVisible();
    await expect
      .poll(async () => {
        const visible = await Promise.all(
          [bob, bobSecond].map((page) =>
            page
              .getByText("Разговор идёт")
              .isVisible()
              .catch(() => false),
          ),
        );
        return visible.filter(Boolean).length;
      })
      .toBe(1);
    const bobWon = await bob
      .getByText("Разговор идёт")
      .isVisible()
      .catch(() => false);
    const activeBob = bobWon ? bob : bobSecond;
    const inactiveBob = bobWon ? bobSecond : bob;
    const activeBobContext = bobWon ? bobContext : bobSecondContext;
    await expect.poll(() => capturedTrackStates(inactiveBob)).toEqual(["ended"]);
    await waitForLiveAudio(alice, 1);
    await waitForLiveAudio(activeBob, 1);

    const active = await prisma.directCall.findFirstOrThrow({
      where: { conversationId: conversation.id, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    });
    await activeBobContext.setOffline(true);
    await expect(alice.getByText("Восстанавливаем соединение…")).toBeVisible({
      timeout: 30_000,
    });
    await activeBob.waitForTimeout(10_000);
    await activeBobContext.setOffline(false);
    await expect(activeBob.getByText("Разговор идёт")).toBeVisible({ timeout: 30_000 });
    await waitForLiveAudio(activeBob, 1);
    await expect(prisma.directCall.findUnique({ where: { id: active.id } })).resolves.toMatchObject(
      {
        id: active.id,
        status: "ACTIVE",
      },
    );

    await activeBobContext.setOffline(true);
    await expect(alice.getByText("Восстанавливаем соединение…")).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(
        async () =>
          (await prisma.directCall.findUnique({ where: { id: active.id } }))?.status ?? null,
        { timeout: 30_000 },
      )
      .toBe("ENDED");
    await activeBobContext.setOffline(false);
    await expect(prisma.directCall.findUnique({ where: { id: active.id } })).resolves.toMatchObject(
      {
        id: active.id,
        status: "ENDED",
      },
    );
    await expect(alice.getByText("Разговор идёт")).not.toBeVisible();
    await expect(alice.getByText(/Звонок завершён/)).toBeVisible();
  } finally {
    await closeContext(aliceContext);
    await closeContext(bobContext);
    await closeContext(bobSecondContext);
  }
});
