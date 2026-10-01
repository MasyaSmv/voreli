import { randomUUID } from "node:crypto";
import { encodeTextContent } from "@voreli/shared";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import {
  aliceUsername,
  aliceUserId,
  prisma,
  serverId,
  bobUsername,
  clientAddresses,
  disposeVoreliFixture,
  login,
  seedVoreliFixture,
} from "./support/voreli-fixture.js";
import { closeContext } from "./support/voice-browser.js";

test.beforeAll(seedVoreliFixture);
test.afterAll(disposeVoreliFixture);

test("channel paste, attachment-only send, reply, reactions and deleted target survive reload", async ({
  browser,
}) => {
  const alice = await browser.newContext({
    locale: "ru-RU",
    permissions: ["clipboard-read", "clipboard-write"],
    extraHTTPHeaders: { "X-Forwarded-For": clientAddresses.alice },
  });
  const bob = await browser.newContext({
    locale: "ru-RU",
    extraHTTPHeaders: { "X-Forwarded-For": clientAddresses.bob },
  });
  const page = await alice.newPage();
  const viewer = await bob.newPage();
  try {
    await login(page, aliceUsername);
    await login(viewer, bobUsername);
    await page.getByRole("button", { name: "general", exact: true }).click();
    await viewer.getByRole("button", { name: "general", exact: true }).click();
    const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: "red" } })
      .png()
      .toBuffer();
    await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) }),
      ]);
    }, image.toString("base64"));
    const draft = page.getByLabel("Сообщение в канале general");
    await draft.focus();
    await page.keyboard.press("Control+V");
    await expect(page.getByText("Готово", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
    const row = page.locator('li[id^="message-"]').first();
    await expect(row.getByRole("img")).toBeVisible();
    await expect(viewer.locator('li[id^="message-"]').first().getByRole("img")).toBeVisible();
    await row.getByRole("button", { name: /^Открыть/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await row.getByLabel("Добавить реакцию").selectOption("👍");
    await expect(viewer.getByRole("button", { name: "👍 1", exact: true })).toBeVisible();
    await row.getByRole("button", { name: "Ответить", exact: true }).click();
    await draft.fill("Reply to the image");
    await page.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
    await expect(viewer.getByText("Reply to the image", { exact: true })).toBeVisible();
    await row.getByRole("button", { name: "Удалить", exact: true }).click();
    await expect(viewer.getByText("Сообщение удалено", { exact: true })).toHaveCount(1);
    await expect(
      viewer
        .locator('li[id^="message-"]')
        .nth(1)
        .getByRole("button", { name: /Сообщение удалено/ }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "general", exact: true }).click();
    await expect(page.getByText("Reply to the image", { exact: true })).toBeVisible();
    await expect(page.locator('li[id^="message-"]').first().getByRole("img")).toHaveCount(0);
  } finally {
    await closeContext(alice);
    await closeContext(bob);
  }
});

test("reply navigation loads an older cursor page and scrolls to its target", async ({
  browser,
}) => {
  const channelId = randomUUID();
  await prisma.channel.create({
    data: { id: channelId, serverId, name: "old-replies", type: "TEXT" },
  });
  const targetId = randomUUID();
  const now = Date.now();
  await prisma.message.create({
    data: {
      id: targetId,
      channelId,
      authorId: aliceUserId,
      content: Buffer.from(encodeTextContent("An older target")),
      createdAt: new Date(now - 60_000),
    },
  });
  await prisma.message.createMany({
    data: Array.from({ length: 55 }, (_, index) => ({
      id: randomUUID(),
      channelId,
      authorId: aliceUserId,
      content: Buffer.from(encodeTextContent(`filler ${index}`)),
      createdAt: new Date(now - 55_000 + index * 100),
    })),
  });
  await prisma.message.create({
    data: {
      id: randomUUID(),
      channelId,
      authorId: aliceUserId,
      content: Buffer.from(encodeTextContent("Latest reply")),
      replyToId: targetId,
    },
  });
  const context = await browser.newContext({
    locale: "ru-RU",
    extraHTTPHeaders: { "X-Forwarded-For": clientAddresses.alice },
  });
  const page = await context.newPage();
  try {
    await login(page, aliceUsername);
    await page.getByRole("button", { name: /^old-replies(?:\s|$)/ }).click();
    await expect(page.getByText("Latest reply", { exact: true })).toBeVisible();
    await expect(page.locator(`[id="message-${targetId}"]`)).toHaveCount(0);
    await page.getByRole("button", { name: "Alice An older target", exact: true }).click();
    await expect(page.locator(`[id="message-${targetId}"]`)).toBeInViewport();
  } finally {
    await closeContext(context);
  }
});
