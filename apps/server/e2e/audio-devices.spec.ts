import { randomUUID } from "node:crypto";

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_EVERYONE_PERMISSIONS } from "@voreli/shared";
import argon2 from "argon2";

import { PulseAudioHarness } from "./support/pulse-audio-harness.js";

const prisma = new PrismaClient();
const password = "playwright audio device password";
const suffix = randomUUID().slice(0, 8);
const username = `audio-device-${suffix}`;
const serverId = randomUUID();
const userId = randomUUID();
const voiceChannelName = "Audio devices";
let pulseAvailable = false;
let pulse: PulseAudioHarness;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  pulseAvailable = await PulseAudioHarness.isAvailable();
  if (!pulseAvailable && process.env["VORELI_REQUIRE_PULSE_AUDIO"] === "1") {
    throw new Error(
      "PulseAudio is required in this environment; refusing to report skipped device coverage",
    );
  }
  const passwordHash = await argon2.hash(password);
  const roleId = randomUUID();
  await prisma.server.create({
    data: {
      id: serverId,
      name: "Audio device e2e",
      owner: {
        create: { id: userId, username, displayName: "Audio device user", passwordHash },
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
        create: { id: randomUUID(), name: voiceChannelName, type: "VOICE", position: 0 },
      },
      members: {
        create: { id: randomUUID(), userId, roles: { create: { roleId } } },
      },
    },
  });
});

test.beforeEach(() => {
  test.skip(
    !pulseAvailable,
    "PulseAudio device tests require a running server plus pactl, paplay and parec",
  );
  pulse = new PulseAudioHarness();
});

test.afterEach(async () => {
  await pulse?.close();
});

test.afterAll(async () => {
  await prisma.server.delete({ where: { id: serverId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

test("falls back when the selected microphone disappears without rebuilding media", async ({
  browser,
}) => {
  test.setTimeout(75_000);
  const fallback = await pulse.createMicrophone("voreli_fallback", "Voreli_Fallback_Microphone");
  const selected = await pulse.createMicrophone("voreli_selected", "Voreli_Selected_Microphone");
  const defaultOutput = await pulse.createOutput("voreli_default_output", "Voreli_Default_Output");
  await pulse.setDefaultMicrophone(fallback);
  await pulse.setDefaultOutput(defaultOutput);

  const context = await deviceContext(browser, "2001:db8::30:1");
  const page = await context.newPage();
  try {
    await joinVoice(page, selected.label);
    const before = await mediaGraph(page);

    await pulse.removeMicrophone(selected);

    await expect
      .poll(() => browserHasDevice(page, "audioinput", selected.label), { timeout: 20_000 })
      .toBe(false);
    await expect.poll(() => capturedTrackStates(page), { timeout: 20_000 }).toContain("ended");
    await expect.poll(() => capturedTrackStates(page), { timeout: 20_000 }).toContain("live");
    await expect
      .poll(() => mediaGraph(page))
      .toMatchObject({
        peerConnections: before.peerConnections,
        audioSenders: before.audioSenders,
      });
    await expect(page.getByText("Голос подключён")).toBeVisible();
    await openVoiceSettings(page);
    await expect(page.getByRole("combobox", { name: /Микрофон/ })).toHaveValue("");
  } finally {
    await context.close();
  }
});

test("shows an error and releases capture when no fallback microphone remains", async ({
  browser,
}) => {
  test.setTimeout(75_000);
  const fallback = await pulse.createMicrophone(
    "voreli_missing_fallback",
    "Voreli_Missing_Fallback",
  );
  const selected = await pulse.createMicrophone(
    "voreli_missing_selected",
    "Voreli_Missing_Selected",
  );
  const defaultOutput = await pulse.createOutput("voreli_failure_output", "Voreli_Failure_Output");
  await pulse.setDefaultMicrophone(fallback);
  await pulse.setDefaultOutput(defaultOutput);

  const context = await deviceContext(browser, "2001:db8::30:2");
  const page = await context.newPage();
  try {
    await joinVoice(page, selected.label);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Browser.setPermission", {
      permission: { name: "microphone" },
      setting: "denied",
      origin: "http://127.0.0.1:5174",
    });
    await pulse.removeMicrophone(selected);

    await expect
      .poll(() => browserHasDevice(page, "audioinput", selected.label), { timeout: 20_000 })
      .toBe(false);
    await expect.poll(() => capturedTrackStates(page), { timeout: 20_000 }).not.toContain("live");
    await expect(page.getByText("Голос подключён")).toBeVisible();
    await openVoiceSettings(page);
    await expect(page.getByRole("alert")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("routes SFU echo to the selected PulseAudio sink", async ({ browser }) => {
  test.setTimeout(60_000);
  const microphone = await pulse.createMicrophone("voreli_routing", "Voreli_Routing_Microphone");
  const defaultOutput = await pulse.createOutput(
    "voreli_routing_default",
    "Voreli_Routing_Default",
  );
  const selectedOutput = await pulse.createOutput(
    "voreli_routing_selected",
    "Voreli_Routing_Selected",
  );
  await pulse.setDefaultMicrophone(microphone);
  await pulse.setDefaultOutput(defaultOutput);

  const context = await deviceContext(browser, "2001:db8::30:3");
  const page = await context.newPage();
  try {
    await joinVoice(page, microphone.label);
    await page.getByRole("button", { name: "Проверить эхо" }).click();
    await expect(page.locator("audio")).toHaveCount(1);
    const sinkId = await outputDeviceId(page, selectedOutput.label);
    await page.locator("audio").evaluate(async (element, deviceId) => {
      await (element as HTMLAudioElement).setSinkId(deviceId);
    }, sinkId);

    const peak = await pulse.recordSink(selectedOutput.sinkName, async () => {
      await pulse.playSine(microphone.sinkName, 2_500);
    });

    expect(peak).toBeGreaterThan(500);
  } finally {
    await context.close();
  }
});

async function deviceContext(browser: Browser, clientAddress: string): Promise<BrowserContext> {
  const context = await browser.newContext({
    permissions: ["microphone"],
    locale: "ru-RU",
    extraHTTPHeaders: { "X-Forwarded-For": clientAddress },
  });
  await context.addInitScript(() => {
    const peerConnections: RTCPeerConnection[] = [];
    const capturedTracks: MediaStreamTrack[] = [];
    const NativePeerConnection = window.RTCPeerConnection;
    const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const instrumentedWindow = window as Window & {
      __voicePeerConnections?: RTCPeerConnection[];
      __capturedMicrophoneTracks?: MediaStreamTrack[];
    };
    instrumentedWindow.__voicePeerConnections = peerConnections;
    instrumentedWindow.__capturedMicrophoneTracks = capturedTracks;
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await nativeGetUserMedia(constraints);
      capturedTracks.push(...stream.getAudioTracks());
      return stream;
    };
    window.RTCPeerConnection = class extends NativePeerConnection {
      constructor(configuration?: RTCConfiguration) {
        super(configuration);
        peerConnections.push(this);
      }
    };
  });
  return context;
}

async function joinVoice(page: Page, inputLabel: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Имя").fill(username);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByRole("heading", { name: "Audio device e2e" })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(voiceChannelName) }).click();
  await page.getByRole("button", { name: "Настройки голоса" }).click();
  await page.getByRole("combobox", { name: /Микрофон/ }).selectOption({ label: inputLabel });
  await page.getByRole("button", { name: "Подключиться" }).click();
  await expect(page.getByText("Голос подключён")).toBeVisible();
}

async function capturedTrackStates(page: Page): Promise<readonly MediaStreamTrackState[]> {
  return page.evaluate(
    () =>
      (
        window as Window & { __capturedMicrophoneTracks?: MediaStreamTrack[] }
      ).__capturedMicrophoneTracks?.map((track) => track.readyState) ?? [],
  );
}

async function mediaGraph(page: Page): Promise<{
  readonly peerConnections: number;
  readonly audioSenders: number;
}> {
  return page.evaluate(() => {
    const peerConnections =
      (window as Window & { __voicePeerConnections?: RTCPeerConnection[] })
        .__voicePeerConnections ?? [];
    return {
      peerConnections: peerConnections.length,
      audioSenders: peerConnections
        .flatMap((connection) => connection.getSenders())
        .filter((sender) => sender.track?.kind === "audio").length,
    };
  });
}

async function outputDeviceId(page: Page, label: string): Promise<string> {
  return page.evaluate(async (expectedLabel) => {
    const device = (await navigator.mediaDevices.enumerateDevices()).find(
      (candidate) => candidate.kind === "audiooutput" && candidate.label === expectedLabel,
    );
    if (!device) throw new Error(`Audio output ${expectedLabel} is not visible to Chromium`);
    return device.deviceId;
  }, label);
}

async function openVoiceSettings(page: Page): Promise<void> {
  const heading = page.getByRole("heading", { name: "Голос и устройства" });
  if (!(await heading.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Настройки голоса" }).click();
  }
  await expect(heading).toBeVisible();
}

async function browserHasDevice(
  page: Page,
  kind: MediaDeviceKind,
  label: string,
): Promise<boolean> {
  return page.evaluate(
    async ({ expectedKind, expectedLabel }) =>
      (await navigator.mediaDevices.enumerateDevices()).some(
        (device) => device.kind === expectedKind && device.label === expectedLabel,
      ),
    { expectedKind: kind, expectedLabel: label },
  );
}
