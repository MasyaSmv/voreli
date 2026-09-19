import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { Permission } from "@voreli/shared";

import {
  capturedTrackStates,
  closeContext,
  voiceContext,
  voicePeerConnectionCount,
  waitForInboundAudioToResume,
  waitForInboundAudioToStop,
  waitForLiveAudio,
  waitForOutboundAudioToResume,
  waitForOutboundAudioToStop,
  waitForPausedPlayback,
} from "./support/voice-browser.js";
import {
  aliceUsername,
  bobUserId,
  bobUsername,
  charlieUsername,
  clientAddresses,
  disposeVoreliFixture,
  login,
  prisma,
  seedVoreliFixture,
  serverId,
  suffix,
  textChannelName,
} from "./support/voreli-fixture.js";

test.beforeAll(seedVoreliFixture);
test.afterAll(disposeVoreliFixture);

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
    await alice.getByRole("button", { name: "Настройки голоса" }).click();
    await alice.getByRole("button", { name: "Проверить микрофон" }).click();
    await expect.poll(() => capturedTrackStates(alice)).toEqual(["live"]);
    await alice.getByRole("button", { name: "Подключиться" }).click();
    await expect(alice.getByText("Голос подключён")).toBeVisible();
    await expect.poll(() => capturedTrackStates(alice)).toEqual(["live"]);

    await alice.getByRole("button", { name: "Проверить эхо" }).click();
    await expect.poll(() => alice.locator("audio").count()).toBe(1);
    await waitForLiveAudio(alice, 1);

    await login(bob, bobUsername);
    await bob.getByRole("button", { name: /Голосовой/ }).click();
    await bob.getByRole("button", { name: "Подключиться" }).click();
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

    const bobParticipant = alice
      .getByRole("listitem")
      .filter({ hasText: `Участник ${bobUserId.slice(0, 6)}` });
    await bobParticipant.getByRole("button", { name: "Заглушить" }).click();
    await expect(bob.getByText("Микрофон выключен")).toBeVisible();
    await bob.getByRole("button", { name: "Выключить микрофон" }).click();
    await bob.getByRole("button", { name: "Включить микрофон" }).click();
    await expect(bob.getByText("Микрофон выключен")).toBeVisible();
    await bobParticipant.getByRole("button", { name: "Снять заглушение" }).click();

    await bob.getByRole("button", { name: "Настройки голоса" }).click();
    const peerConnectionsBeforeInputChange = await voicePeerConnectionCount(bob);
    const microphoneSelect = bob.getByRole("combobox", { name: /Микрофон/ });
    const inputOptions = microphoneSelect.locator("option");
    if ((await inputOptions.count()) > 1) {
      await microphoneSelect.selectOption({ index: 1 });
      await expect.poll(() => capturedTrackStates(bob)).toContain("ended");
      await expect.poll(() => capturedTrackStates(bob)).toContain("live");
      await expect(voicePeerConnectionCount(bob)).resolves.toBe(peerConnectionsBeforeInputChange);
    }

    await bob.getByLabel("Режим ввода").selectOption("push-to-talk");
    await waitForOutboundAudioToStop(bob);
    await bob.keyboard.down("KeyV");
    await waitForOutboundAudioToResume(bob);
    await bob.keyboard.up("KeyV");
    await waitForOutboundAudioToStop(bob);
    await bob.keyboard.down("KeyV");
    await waitForOutboundAudioToResume(bob);
    await bob.evaluate(() => window.dispatchEvent(new Event("blur")));
    await waitForOutboundAudioToStop(bob);
    await bob.keyboard.up("KeyV");
    await bob.getByLabel("Клавиша PTT").focus();
    await bob.keyboard.down("KeyV");
    await waitForOutboundAudioToStop(bob);
    await bob.keyboard.up("KeyV");
    await bob.getByLabel("Режим ввода").selectOption("voice-activity");
    await waitForOutboundAudioToResume(bob);

    await bob.getByRole("button", { name: "Выключить звук" }).click();
    await waitForPausedPlayback(bob, 1);

    const [voiceChannel, charlieMember] = await Promise.all([
      prisma.channel.findFirstOrThrow({ where: { serverId, name: "Голосовой" } }),
      prisma.member.findFirstOrThrow({
        where: { serverId, user: { username: charlieUsername } },
      }),
    ]);
    await prisma.channelOverride.create({
      data: {
        id: randomUUID(),
        channelId: voiceChannel.id,
        memberId: charlieMember.id,
        deny: Permission.Speak,
      },
    });
    await login(charlie, charlieUsername);
    await charlie.getByRole("button", { name: /Голосовой/ }).click();
    await charlie.getByRole("button", { name: "Подключиться" }).click();
    await expect(charlie.getByText("Голос подключён")).toBeVisible();
    await expect.poll(() => capturedTrackStates(charlie)).toEqual(["ended"]);

    await waitForLiveAudio(charlie, 2);
    await waitForPausedPlayback(bob, 1);
    await waitForLiveAudio(alice, 2);

    await bob.getByRole("button", { name: "Включить звук" }).click();
    await waitForLiveAudio(bob, 1);

    await bobParticipant.getByRole("button", { name: "Заглушить" }).click();
    await bobContext.setOffline(true);
    await expect(bob.getByText("Восстанавливаем соединение…")).toBeVisible({ timeout: 30_000 });
    await bobContext.setOffline(false);
    await expect(bob.getByText("Голос подключён")).toBeVisible({ timeout: 30_000 });
    await expect(bob.getByText("Микрофон выключен")).toBeVisible();
    await bobParticipant.getByRole("button", { name: "Снять заглушение" }).click();
    await waitForInboundAudioToResume(bob);
  } finally {
    await closeContext(aliceContext);
    await closeContext(bobContext);
    await closeContext(charlieContext);
  }
});
