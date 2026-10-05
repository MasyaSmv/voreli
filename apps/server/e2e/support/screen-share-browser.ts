import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect, type Page } from "@playwright/test";

import { inboundAudioBytes, mediaStats } from "./voice-browser.js";

const execFileAsync = promisify(execFile);

export const screenShareNetemEnabled = process.env["SCREEN_SHARE_NETEM"] === "1";

export async function waitForLiveVideo(page: Page): Promise<void> {
  await page.waitForFunction(
    `Array.from(document.querySelectorAll("video")).some((element) => {
      const stream = element.srcObject;
      if (!(stream instanceof MediaStream)) return false;
      const track = stream.getVideoTracks()[0];
      return track !== undefined && track.readyState === "live" && !element.paused;
    })`,
    undefined,
    { timeout: 15_000 },
  );
}

export async function waitForRenderedVideos(page: Page, count: number): Promise<void> {
  await page.waitForFunction(
    (expectedCount) => {
      const videos = Array.from(document.querySelectorAll("video"));
      return (
        videos.length === expectedCount &&
        videos.every(
          (video) =>
            video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
            video.videoWidth > 0 &&
            video.videoHeight > 0,
        )
      );
    },
    count,
    { timeout: 15_000 },
  );
}

export async function stopCapturedDisplay(page: Page): Promise<void> {
  await page.evaluate(() => {
    const tracks = (window as Window & { __capturedDisplayTracks?: MediaStreamTrack[] })
      .__capturedDisplayTracks;
    const video = tracks?.find((track) => track.kind === "video" && track.readyState === "live");
    if (!video) throw new Error("No live captured display video track");
    video.stop();
    video.dispatchEvent(new Event("ended"));
  });
}

export async function inboundVideoBytes(page: Page): Promise<number> {
  return (await mediaStats(page, "inbound-rtp", "video")).bytes;
}

interface InboundVideoStats {
  readonly bytesReceived: number;
  readonly framesDecoded: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
}

export async function inboundVideoStats(page: Page): Promise<InboundVideoStats> {
  const result = await mediaStats(page, "inbound-rtp", "video");
  return {
    bytesReceived: result.bytes,
    framesDecoded: result.framesDecoded,
    frameWidth: result.frameWidth,
    frameHeight: result.frameHeight,
  };
}

export async function waitForInboundVideoDimensions(
  page: Page,
  widerThan = 0,
): Promise<InboundVideoStats> {
  await expect
    .poll(async () => (await inboundVideoStats(page)).frameWidth, { timeout: 20_000 })
    .toBeGreaterThan(widerThan);
  return inboundVideoStats(page);
}

export async function selectedInboundVideoPort(page: Page): Promise<number> {
  const port = await page.evaluate(async () => {
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
    const peerConnections = (window as Window & { __voicePeerConnections?: RTCPeerConnection[] })
      .__voicePeerConnections;
    for (const peerConnection of peerConnections ?? []) {
      const reports = await peerConnection.getStats();
      for (const report of reports.values() as Iterable<unknown>) {
        if (statString(report, "type") !== "inbound-rtp" || statString(report, "kind") !== "video")
          continue;
        const transportId = statString(report, "transportId");
        const transport: unknown = transportId ? reports.get(transportId) : undefined;
        const selectedCandidatePairId = statString(transport, "selectedCandidatePairId");
        const candidatePair: unknown = selectedCandidatePairId
          ? reports.get(selectedCandidatePairId)
          : undefined;
        const localCandidateId = statString(candidatePair, "localCandidateId");
        const localCandidate: unknown = localCandidateId
          ? reports.get(localCandidateId)
          : undefined;
        const candidatePort = statNumber(localCandidate, "port");
        if (candidatePort > 0) return candidatePort;
      }
    }
    return 0;
  });
  if (port === 0) throw new Error("No selected inbound screen-video candidate port");
  return port;
}

export async function configureViewerDownlink(rateKbit: number): Promise<void> {
  await clearViewerDownlink();
  await runTc(["qdisc", "add", "dev", "lo", "root", "handle", "1:", "prio", "bands", "3"]);
  await runTc([
    "qdisc",
    "add",
    "dev",
    "lo",
    "parent",
    "1:3",
    "handle",
    "30:",
    "netem",
    "delay",
    "80ms",
    "rate",
    `${String(rateKbit)}kbit`,
  ]);
  for (let sourcePort = 41_000; sourcePort <= 41_010; sourcePort += 1) {
    for (const protocol of ["ip", "ipv6"] as const) {
      for (const transport of ["udp", "tcp"] as const) {
        await runTc([
          "filter",
          "add",
          "dev",
          "lo",
          "protocol",
          protocol,
          "parent",
          "1:",
          "prio",
          protocol === "ip" ? "1" : "2",
          "flower",
          "ip_proto",
          transport,
          "src_port",
          String(sourcePort),
          "classid",
          "1:3",
        ]);
      }
    }
  }
}

export async function replaceViewerDownlinkRate(rateKbit: number): Promise<void> {
  await runTc([
    "qdisc",
    "replace",
    "dev",
    "lo",
    "parent",
    "1:3",
    "handle",
    "30:",
    "netem",
    "delay",
    "80ms",
    "rate",
    `${String(rateKbit)}kbit`,
  ]);
}

export async function viewerDownlinkQdisc(): Promise<string> {
  const { stdout } = await execFileAsync("tc", ["-s", "qdisc", "show", "dev", "lo"]);
  return stdout;
}

export function netemPacketCount(qdisc: string): number {
  const packetCount = /qdisc netem 30:[\s\S]*?Sent \d+ bytes (\d+) pkt/.exec(qdisc)?.[1];
  return Number(packetCount ?? 0);
}

export function netemByteCount(qdisc: string): number {
  const byteCount = /qdisc netem 30:[\s\S]*?Sent (\d+) bytes/.exec(qdisc)?.[1];
  return Number(byteCount ?? 0);
}

export async function clearViewerDownlink(): Promise<void> {
  try {
    await execFileAsync("tc", ["qdisc", "del", "dev", "lo", "root"]);
  } catch (error: unknown) {
    console.warn("No screen-share netem qdisc to remove", { error });
  }
}

async function runTc(arguments_: readonly string[]): Promise<void> {
  await execFileAsync("tc", [...arguments_]);
}

export async function outboundVideoTrackCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const instrumentedWindow = window as Window & {
      __voicePeerConnections?: RTCPeerConnection[];
    };
    return (instrumentedWindow.__voicePeerConnections ?? []).flatMap((peerConnection) =>
      peerConnection.getSenders().filter((sender) => sender.track?.kind === "video"),
    ).length;
  });
}

export { inboundAudioBytes };
