import { randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";
import sharp from "sharp";

import { holdUploadReady } from "./support/upload-ready-gate.js";
import { closeContext } from "./support/voice-browser.js";
import {
  aliceUserId,
  aliceUsername,
  clientAddresses,
  disposeVoreliFixture,
  login,
  prisma,
  seedVoreliFixture,
} from "./support/voreli-fixture.js";

test.beforeAll(seedVoreliFixture);
test.afterAll(disposeVoreliFixture);

test("pasted avatar uploads directly with progress and resumes after reload during PROCESSING", async ({
  browser,
}) => {
  const context = await browser.newContext({
    locale: "ru-RU",
    permissions: ["clipboard-read", "clipboard-write"],
    extraHTTPHeaders: { "X-Forwarded-For": clientAddresses.alice },
  });
  const page = await context.newPage();
  const release = await holdUploadReady(prisma, aliceUserId);
  try {
    await login(page, aliceUsername);
    await page.getByRole("button", { name: "Открыть профиль и настройки" }).click();
    const image = await sharp(randomBytes(512 * 512 * 3), {
      raw: { width: 512, height: 512, channels: 3 },
    })
      .png()
      .toBuffer();
    await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) }),
      ]);
    }, image.toString("base64"));
    const network = await context.newCDPSession(page);
    await network.send("Network.enable");
    await network.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: 128 * 1024,
    });
    const storageResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().startsWith(process.env["S3_ENDPOINT"] ?? "http://localhost:9000"),
    );
    await page.getByRole("button", { name: "Сменить аватар" }).focus();
    await page.keyboard.press("Control+V");
    await expect(page.getByRole("button", { name: /Загрузка [1-9]\d*%/ })).toBeDisabled();
    expect((await storageResponse).status()).toBe(204);
    await expect
      .poll(
        async () =>
          (
            await prisma.upload.findFirst({
              where: { ownerId: aliceUserId },
              orderBy: { reservedAt: "desc" },
            })
          )?.status,
      )
      .toBe("PROCESSING");
    await expect(page.getByRole("status")).toHaveText("Обрабатываем аватар…");

    await page.reload();
    await expect(page.getByRole("heading", { name: "Voice e2e" })).toBeVisible();
    await page.getByRole("button", { name: "Открыть профиль и настройки" }).click();
    await expect(page.getByRole("status")).toHaveText("Обрабатываем аватар…");
    const assigned = page.waitForResponse(
      (response) =>
        response.url().endsWith("/users/me/avatar") && response.request().method() === "PUT",
    );
    await release();
    expect((await assigned).status()).toBe(200);
    const preview = page.locator('img[src*="/uploads/"]').first();
    await expect(preview).toBeVisible();
    await expect
      .poll(() => preview.evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    expect(
      await page.evaluate(
        (ownerId) => localStorage.getItem(`voreli.pending-avatar.${ownerId}`),
        aliceUserId,
      ),
    ).toBeNull();
  } finally {
    await release();
    await closeContext(context);
  }
});
