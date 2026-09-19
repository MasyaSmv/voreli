import { expect, test } from "@playwright/test";

import {
  clearViewerDownlink,
  configureViewerDownlink,
  inboundAudioBytes,
  inboundVideoBytes,
  inboundVideoStats,
  netemByteCount,
  netemPacketCount,
  outboundVideoTrackCount,
  replaceViewerDownlinkRate,
  screenShareNetemEnabled,
  selectedInboundVideoPort,
  stopCapturedDisplay,
  viewerDownlinkQdisc,
  waitForInboundVideoDimensions,
  waitForLiveVideo,
} from "./support/screen-share-browser.js";
import { closeContext, voiceContext, voicePeerConnectionCount } from "./support/voice-browser.js";
import {
  aliceUserId,
  aliceUsername,
  bobUserId,
  bobUsername,
  disposeVoreliFixture,
  login,
  screenViewerUsername,
  seedVoreliFixture,
  suffix,
} from "./support/voreli-fixture.js";

test.beforeAll(seedVoreliFixture);
test.afterAll(disposeVoreliFixture);

test("two screen shares are watched selectively and track end removes only its own share", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const aliceContext = await voiceContext(browser, `2001:db8::${suffix.slice(0, 4)}:11`);
  const bobContext = await voiceContext(browser, `2001:db8::${suffix.slice(0, 4)}:12`);
  const viewerContext = await voiceContext(browser, `2001:db8::${suffix.slice(0, 4)}:13`);
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  const viewer = await viewerContext.newPage();
  if (screenShareNetemEnabled) await viewer.setViewportSize({ width: 390, height: 844 });

  try {
    await Promise.all([
      login(alice, aliceUsername),
      login(bob, bobUsername),
      login(viewer, screenViewerUsername),
    ]);
    for (const page of [alice, bob, viewer]) {
      await page.getByRole("button", { name: /Голосовой/ }).click();
      await page.getByRole("button", { name: "Подключиться" }).click();
      await expect(page.getByText("Голос подключён")).toBeVisible();
    }

    await alice.getByRole("button", { name: "Показать экран" }).click();
    await expect(bob.getByText(`Экран участника ${aliceUserId.slice(0, 6)}`)).toBeVisible();
    await expect(bob.locator("video")).toHaveCount(0);
    await expect.poll(() => inboundVideoBytes(bob)).toBe(0);
    const aliceShareForBob = bob
      .getByRole("listitem")
      .filter({ hasText: `Экран участника ${aliceUserId.slice(0, 6)}` });
    await aliceShareForBob.getByRole("button", { name: "Смотреть" }).click();
    await waitForLiveVideo(bob);
    if (screenShareNetemEnabled) {
      await bob.getByRole("button", { name: "Не смотреть" }).click();
      await expect(bob.locator("video")).toHaveCount(0);
    }

    await bob.getByRole("button", { name: "Показать экран" }).click();
    const bobShare = viewer
      .getByRole("listitem")
      .filter({ hasText: `Экран участника ${bobUserId.slice(0, 6)}` });
    await expect(bobShare).toBeVisible();

    const aliceShare = viewer
      .getByRole("listitem")
      .filter({ hasText: `Экран участника ${aliceUserId.slice(0, 6)}` });
    await aliceShare.getByRole("button", { name: "Смотреть" }).click();
    await waitForLiveVideo(viewer);
    await expect.poll(() => outboundVideoTrackCount(alice)).toBe(1);

    if (screenShareNetemEnabled) {
      const initial = await waitForInboundVideoDimensions(viewer);
      const viewerMediaPort = await selectedInboundVideoPort(viewer);
      await configureViewerDownlink(350);
      const lowVideoBytes = await inboundVideoBytes(viewer);
      const lowAudioBytes = await inboundAudioBytes(viewer);
      await expect
        .poll(() => inboundVideoBytes(viewer), { timeout: 20_000 })
        .toBeGreaterThan(lowVideoBytes);
      await expect
        .poll(() => inboundAudioBytes(viewer), { timeout: 20_000 })
        .toBeGreaterThan(lowAudioBytes);
      await expect
        .poll(async () => (await inboundVideoStats(viewer)).frameWidth, { timeout: 20_000 })
        .toBeLessThanOrEqual(480);
      const constrainedLow = await inboundVideoStats(viewer);
      const lowAudioBytesAfter = await inboundAudioBytes(viewer);
      const lowQdisc = await viewerDownlinkQdisc();
      expect(netemPacketCount(lowQdisc)).toBeGreaterThan(0);
      expect(netemByteCount(lowQdisc)).toBeGreaterThan(10_000);

      await replaceViewerDownlinkRate(1_200);
      await viewer.setViewportSize({ width: 1_280, height: 900 });
      const medium = await waitForInboundVideoDimensions(viewer, constrainedLow.frameWidth);
      const mediumAudioBytes = await inboundAudioBytes(viewer);
      await expect
        .poll(() => inboundAudioBytes(viewer), { timeout: 20_000 })
        .toBeGreaterThan(mediumAudioBytes);
      const mediumAudioBytesAfter = await inboundAudioBytes(viewer);
      const mediumQdisc = await viewerDownlinkQdisc();
      expect(netemPacketCount(mediumQdisc)).toBeGreaterThan(0);
      expect(netemByteCount(mediumQdisc)).toBeGreaterThan(10_000);
      await test.info().attach("screen-share-netem", {
        body: JSON.stringify(
          {
            viewerMediaPort,
            initial,
            constrainedLow,
            lowAudioBytes,
            lowAudioBytesAfter,
            lowQdisc,
            medium,
            mediumAudioBytes,
            mediumAudioBytesAfter,
            mediumQdisc,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
      await clearViewerDownlink();
    }

    const viewerPeerConnections = await voicePeerConnectionCount(viewer);
    await bobShare.getByRole("button", { name: "Смотреть" }).click();
    await expect(viewer.locator("video")).toHaveCount(1);
    await waitForLiveVideo(viewer);
    await expect.poll(() => outboundVideoTrackCount(bob)).toBe(1);
    await expect(voicePeerConnectionCount(viewer)).resolves.toBe(viewerPeerConnections);

    await stopCapturedDisplay(alice);
    await expect(viewer.getByText(`Экран участника ${aliceUserId.slice(0, 6)}`)).not.toBeVisible();
    await expect(bobShare).toBeVisible();
    await waitForLiveVideo(viewer);

    await bob.reload();
    await expect(bobShare).not.toBeVisible({ timeout: 30_000 });
    await expect(viewer.locator("video")).toHaveCount(0);
    for (const page of [alice, viewer]) {
      await page.getByRole("button", { name: "Выйти из голосового канала" }).click();
      await expect(page.getByText("Голос подключён")).not.toBeVisible();
    }
  } finally {
    if (screenShareNetemEnabled) await clearViewerDownlink();
    await closeContext(aliceContext);
    await closeContext(bobContext);
    await closeContext(viewerContext);
  }
});
