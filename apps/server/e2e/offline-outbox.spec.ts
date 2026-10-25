import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  aliceUsername,
  aliceUserId,
  bobUserId,
  bobUsername,
  disposeVoreliFixture,
  login,
  prisma,
  seedVoreliFixture,
} from "./support/voreli-fixture.js";
import { closeContext } from "./support/voice-browser.js";

test.beforeAll(seedVoreliFixture);
test.afterAll(disposeVoreliFixture);

function testAddress(): string {
  return `2001:db8::${randomUUID().slice(0, 4)}:${randomUUID().slice(0, 4)}`;
}

test("channel text stays durable while offline and is sent once after reload", async ({
  browser,
}) => {
  const context = await browser.newContext({
    locale: "ru-RU",
    extraHTTPHeaders: { "X-Forwarded-For": testAddress() },
  });
  const page = await context.newPage();
  const text = `Offline outbox ${crypto.randomUUID()}`;
  try {
    await login(page, aliceUsername);
    await page.getByRole("button", { name: "general", exact: true }).click();
    await expect(page.getByLabel("Сообщение в канале general")).toBeVisible();

    await context.setOffline(true);
    await page.getByLabel("Сообщение в канале general").fill(text);
    await page.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
    const pending = page.locator('li[id^="pending-"]', { hasText: text });
    await expect(pending).toBeVisible();
    await expect(page.getByLabel("Сообщение в канале general")).toHaveValue("");
    const nonce = await pending.getAttribute("id");
    expect(nonce).toMatch(/^pending-[0-9a-f-]+$/);
    const stored = await page.evaluate(async () => {
      const request = indexedDB.open("voreli-message-outbox");
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
      });
      const transaction = database.transaction("entries", "readonly");
      const all = transaction.objectStore("entries").getAll();
      const entries = await new Promise<unknown[]>((resolve, reject) => {
        all.onsuccess = () => resolve(all.result as unknown[]);
        all.onerror = () => reject(all.error ?? new Error("IndexedDB read failed"));
      });
      database.close();
      return entries;
    });
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(text);

    await context.setOffline(false);
    await page.reload();
    await page.getByRole("button", { name: "general", exact: true }).click();
    await expect(page.locator('li[id^="message-"]', { hasText: text })).toBeVisible();
    await expect(page.locator('li[id^="pending-"]', { hasText: text })).toHaveCount(0);
    const clientNonce = nonce?.slice("pending-".length);
    expect(clientNonce).toBeTruthy();
    await expect
      .poll(() =>
        prisma.message.count({ where: { authorId: aliceUserId, clientNonce: clientNonce! } }),
      )
      .toBe(1);
  } finally {
    await context.setOffline(false);
    await closeContext(context);
  }
});

test("expired socket token refreshes before the queued message flushes", async ({ browser }) => {
  const context = await browser.newContext({
    locale: "ru-RU",
    extraHTTPHeaders: { "X-Forwarded-For": testAddress() },
  });
  const page = await context.newPage();
  const text = `Expired token outbox ${randomUUID()}`;
  try {
    await login(page, aliceUsername);
    await page.getByRole("button", { name: "general", exact: true }).click();
    await context.setOffline(true);
    await page.getByLabel("Сообщение в канале general").fill(text);
    await page.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
    await expect(page.locator('li[id^="pending-"]', { hasText: text })).toBeVisible();
    await page.evaluate(async () => {
      const path = "/src/shared/api/http.ts";
      const http = (await import(path)) as unknown as {
        setAccessToken(token: string | null): void;
      };
      http.setAccessToken("expired-token");
    });
    const refresh = page.waitForResponse(
      (response) => response.url().endsWith("/auth/refresh") && response.status() === 200,
    );
    await context.setOffline(false);
    await refresh;
    await expect(page.locator('li[id^="message-"]', { hasText: text })).toBeVisible();
    await expect(page.locator('li[id^="pending-"]', { hasText: text })).toHaveCount(0);
  } finally {
    await context.setOffline(false);
    await closeContext(context);
  }
});

test("direct text queued offline is sent after changing conversations", async ({ browser }) => {
  const userLowId = aliceUserId < bobUserId ? aliceUserId : bobUserId;
  const userHighId = aliceUserId < bobUserId ? bobUserId : aliceUserId;
  const conversation = await prisma.directConversation.create({
    data: { id: randomUUID(), userLowId, userHighId },
  });
  const context = await browser.newContext({
    locale: "ru-RU",
    extraHTTPHeaders: { "X-Forwarded-For": testAddress() },
  });
  const page = await context.newPage();
  const text = `Offline direct ${randomUUID()}`;
  try {
    await login(page, aliceUsername);
    await page.getByRole("button", { name: "Главная Voreli" }).click();
    await page.getByRole("button", { name: new RegExp(`Bob.*@${bobUsername}`) }).click();
    const draft = page.getByLabel("Сообщение для Bob");
    await expect(draft).toBeVisible();
    await context.setOffline(true);
    await draft.fill(text);
    await page.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
    await expect(page.locator('li[id^="pending-"]', { hasText: text })).toBeVisible();
    await context.setOffline(false);
    await page.getByRole("button", { name: "Главная Voreli" }).click();
    await expect
      .poll(() =>
        prisma.message.count({
          where: { directConversationId: conversation.id, authorId: aliceUserId },
        }),
      )
      .toBe(1);
    await page.getByRole("button", { name: new RegExp(`Bob.*@${bobUsername}`) }).click();
    await expect(page.locator('li[id^="message-"]', { hasText: text })).toBeVisible();
    await expect(page.locator('li[id^="pending-"]', { hasText: text })).toHaveCount(0);
  } finally {
    await context.setOffline(false);
    await closeContext(context);
  }
});

test("another account cannot see or flush a previous account's queued text", async ({
  browser,
}) => {
  const context = await browser.newContext({
    locale: "ru-RU",
    extraHTTPHeaders: { "X-Forwarded-For": testAddress() },
  });
  const firstPage = await context.newPage();
  const text = `Private queued text ${randomUUID()}`;
  try {
    await login(firstPage, aliceUsername);
    await firstPage.getByRole("button", { name: "general", exact: true }).click();
    await context.setOffline(true);
    await firstPage.getByLabel("Сообщение в канале general").fill(text);
    await firstPage.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
    const pending = firstPage.locator('li[id^="pending-"]', { hasText: text });
    await expect(pending).toBeVisible();
    const nonce = (await pending.getAttribute("id"))?.slice("pending-".length);
    if (!nonce) throw new Error("Pending message has no nonce");
    await firstPage.close();

    await context.clearCookies();
    await context.setOffline(false);
    const secondPage = await context.newPage();
    await login(secondPage, bobUsername);
    await secondPage.getByRole("button", { name: "general", exact: true }).click();
    await expect(secondPage.getByText(text, { exact: true })).toHaveCount(0);
    await expect
      .poll(() => prisma.message.count({ where: { authorId: bobUserId, clientNonce: nonce } }))
      .toBe(0);
    await secondPage.close();

    await context.clearCookies();
    const restoredPage = await context.newPage();
    await login(restoredPage, aliceUsername);
    await restoredPage.getByRole("button", { name: "general", exact: true }).click();
    await expect(restoredPage.locator('li[id^="message-"]', { hasText: text })).toBeVisible();
    await expect
      .poll(() => prisma.message.count({ where: { authorId: aliceUserId, clientNonce: nonce } }))
      .toBe(1);
  } finally {
    await context.setOffline(false);
    await closeContext(context);
  }
});
