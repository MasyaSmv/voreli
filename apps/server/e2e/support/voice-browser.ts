import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";

export async function voiceContext(
  browser: Browser,
  clientAddress: string,
): Promise<BrowserContext> {
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
      __capturedMicrophoneTracks: MediaStreamTrack[];
      __capturedCameraTracks: MediaStreamTrack[];
      __capturedDisplayTracks: MediaStreamTrack[];
    };
    instrumentedWindow.__voicePeerConnections = peerConnections;
    instrumentedWindow.__capturedMicrophoneTracks = [];
    instrumentedWindow.__capturedCameraTracks = [];
    instrumentedWindow.__capturedDisplayTracks = [];
    const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await nativeGetUserMedia(constraints);
      instrumentedWindow.__capturedMicrophoneTracks.push(...stream.getAudioTracks());
      instrumentedWindow.__capturedCameraTracks.push(...stream.getVideoTracks());
      return stream;
    };
    const nativeGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getDisplayMedia = async (constraints) => {
      const stream = await nativeGetDisplayMedia(constraints);
      instrumentedWindow.__capturedDisplayTracks.push(...stream.getTracks());
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

export async function capturedTrackStates(page: Page): Promise<readonly MediaStreamTrackState[]> {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __capturedMicrophoneTracks?: MediaStreamTrack[];
        }
      ).__capturedMicrophoneTracks?.map((track) => track.readyState) ?? [],
  );
}

export async function waitForLiveAudio(page: Page, expectedTracks: number): Promise<void> {
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

export async function waitForPausedPlayback(page: Page, expectedTracks: number): Promise<void> {
  await page.waitForFunction(
    `Array.from(document.querySelectorAll("audio")).length === ${String(expectedTracks)} &&
    Array.from(document.querySelectorAll("audio")).every((element) => element.paused)`,
    undefined,
    { timeout: 15_000 },
  );
}

export async function waitForInboundAudioToStop(page: Page): Promise<void> {
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

export async function waitForInboundAudioToResume(page: Page): Promise<void> {
  const before = await inboundAudioBytes(page);
  await expect.poll(() => inboundAudioBytes(page)).toBeGreaterThan(before);
}

export async function inboundAudioBytes(page: Page): Promise<number> {
  return (await mediaStats(page, "inbound-rtp", "audio")).bytes;
}

interface MediaStats {
  readonly bytes: number;
  readonly framesDecoded: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
}

export async function mediaStats(
  page: Page,
  direction: "inbound-rtp" | "outbound-rtp",
  kind: "audio" | "video",
): Promise<MediaStats> {
  return page.evaluate(
    async ({ direction, kind }) => {
      const statString = (value: unknown, property: string): string | undefined => {
        if (typeof value !== "object" || value === null) return undefined;
        const candidate = (value as Record<string, unknown>)[property];
        return typeof candidate === "string" ? candidate : undefined;
      };
      const statNumber = (value: unknown, property: string): number => {
        if (typeof value !== "object" || value === null) return 0;
        const candidate = (value as Record<string, unknown>)[property];
        return typeof candidate === "number" ? candidate : 0;
      };
      const instrumentedWindow = window as Window & {
        __voicePeerConnections?: RTCPeerConnection[];
      };
      const result = { bytes: 0, framesDecoded: 0, frameWidth: 0, frameHeight: 0 };
      for (const peerConnection of instrumentedWindow.__voicePeerConnections ?? []) {
        const reports = await peerConnection.getStats();
        reports.forEach((report: unknown) => {
          if (statString(report, "type") !== direction || statString(report, "kind") !== kind)
            return;
          result.bytes += statNumber(
            report,
            direction === "inbound-rtp" ? "bytesReceived" : "bytesSent",
          );
          result.framesDecoded += statNumber(report, "framesDecoded");
          result.frameWidth = Math.max(result.frameWidth, statNumber(report, "frameWidth"));
          result.frameHeight = Math.max(result.frameHeight, statNumber(report, "frameHeight"));
        });
      }
      return result;
    },
    { direction, kind },
  );
}

export async function waitForOutboundAudioToStop(page: Page): Promise<void> {
  let previous = await outboundAudioBytes(page);
  await expect
    .poll(async () => {
      await page.waitForTimeout(500);
      const current = await outboundAudioBytes(page);
      const stopped = current === previous;
      previous = current;
      return stopped;
    })
    .toBe(true);
}

export async function waitForOutboundAudioToResume(page: Page): Promise<void> {
  const before = await outboundAudioBytes(page);
  await expect.poll(() => outboundAudioBytes(page)).toBeGreaterThan(before);
}

async function outboundAudioBytes(page: Page): Promise<number> {
  return (await mediaStats(page, "outbound-rtp", "audio")).bytes;
}

export async function voicePeerConnectionCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as Window & { __voicePeerConnections?: RTCPeerConnection[] }).__voicePeerConnections
        ?.length ?? 0,
  );
}

export async function closeContext(context: BrowserContext): Promise<void> {
  await context.close();
}
