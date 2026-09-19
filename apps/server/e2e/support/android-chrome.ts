import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cdpScript = fileURLToPath(new URL("./android-cdp.ps1", import.meta.url));
const androidUiDumpPath = "/sdcard/voreli-window.xml";

interface AndroidChromeOptions {
  readonly origin: string;
  readonly reversePorts: readonly number[];
}

interface CdpRemoteObject {
  readonly value?: unknown;
}

interface CdpResponse {
  readonly error?: { readonly message?: unknown };
  readonly result?: { readonly result?: CdpRemoteObject };
}

export interface AndroidInboundVideoStats {
  readonly bytesReceived: number;
  readonly framesDecoded: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
}

export class AndroidChrome {
  private constructor(
    private readonly adbPath: string,
    private readonly cdpScriptPath: string,
    private readonly origin: string,
    private readonly reversePorts: readonly number[],
  ) {}

  static async connect(options: AndroidChromeOptions): Promise<AndroidChrome> {
    const { stdout: sdkRootOutput } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      '[Environment]::GetEnvironmentVariable("ANDROID_SDK_ROOT","User")',
    ]);
    const sdkRoot = sdkRootOutput.trim();
    if (!sdkRoot) throw new Error("ANDROID_SDK_ROOT is not configured on the Windows host");
    const { stdout: adbPathOutput } = await execFileAsync("wslpath", [
      "-u",
      `${sdkRoot}\\platform-tools\\adb.exe`,
    ]);
    const { stdout: scriptPathOutput } = await execFileAsync("wslpath", ["-w", cdpScript]);
    return new AndroidChrome(
      adbPathOutput.trim(),
      scriptPathOutput.trim(),
      options.origin,
      options.reversePorts,
    );
  }

  async prepare(): Promise<void> {
    const devices = await this.adb("devices");
    if (!devices.includes("emulator-") || !devices.includes("\tdevice")) {
      throw new Error(`No ready Android emulator found:\n${devices}`);
    }
    await this.adb("shell", "am", "force-stop", "com.android.chrome");
    await this.adb("shell", "pm", "grant", "com.android.chrome", "android.permission.RECORD_AUDIO");
    await this.adb("shell", "svc", "power", "stayon", "true");
    for (const port of this.reversePorts) {
      await this.adb("reverse", `tcp:${String(port)}`, `tcp:${String(port)}`);
    }
    await this.adb("forward", "tcp:9222", "localabstract:chrome_devtools_remote");
    await this.adb(
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      "about:blank",
      "com.android.chrome",
    );
    await this.waitForCdp();
    await this.call("Harness.closeOtherPages", {}, "page", "about:");
    await this.call("Page.navigate", { url: `${this.origin}/` }, "page", "about:");
    await this.waitForTruthy(
      `[...document.querySelectorAll("button")].some((button) => button.textContent?.trim() === "ru")`,
    );
    if (!(await this.evaluate<boolean>('document.body?.innerText.includes("Войдите в Voreli")'))) {
      await this.clickButton("ru");
    }
    await this.waitForText("Войдите в Voreli");
    const installed = await this.evaluate<boolean>(`(() => {
      const NativePeerConnection = window.RTCPeerConnection;
      window.__androidPeerConnections = [];
      window.RTCPeerConnection = class extends NativePeerConnection {
        constructor(configuration) {
          super(configuration);
          window.__androidPeerConnections.push(this);
        }
      };
      return Array.isArray(window.__androidPeerConnections);
    })()`);
    if (!installed) {
      throw new Error("Android Chrome WebRTC instrumentation was not installed");
    }
  }

  async close(): Promise<void> {
    await this.adb("shell", "am", "force-stop", "com.android.chrome").catch(() => undefined);
    await this.adb("shell", "rm", "-f", androidUiDumpPath).catch(() => undefined);
    await this.adb("forward", "--remove", "tcp:9222").catch(() => undefined);
    for (const port of this.reversePorts) {
      await this.adb("reverse", "--remove", `tcp:${String(port)}`).catch(() => undefined);
    }
  }

  async login(username: string, password: string): Promise<void> {
    await this.evaluate(`(() => {
      const set = (selector, value) => {
        const input = document.querySelector(selector);
        if (!(input instanceof HTMLInputElement)) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      };
      return set('input[autocomplete="username"]', ${JSON.stringify(username)}) &&
        set('input[autocomplete="current-password"]', ${JSON.stringify(password)});
    })()`);
    await this.clickButton("Войти");
    await this.waitForText("Voice Android e2e");
  }

  async clickButton(text: string): Promise<void> {
    const clicked = await this.evaluate<boolean>(
      `(() => {
      const target = ${JSON.stringify(text)};
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.trim() === target);
      if (!button) return false;
      button.click();
      return true;
    })()`,
      this.origin,
      true,
    );
    if (!clicked) {
      const body = await this.evaluate<string>("document.body?.innerText ?? ''");
      throw new Error(`Android Chrome button not found: ${text}\n${body}`);
    }
  }

  async allowMicrophonePrompt(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastHierarchy = "";
    while (Date.now() < deadline) {
      const mediaReady = await this.evaluate<boolean>(
        "(window.__androidPeerConnections?.length ?? 0) > 0",
      );
      if (mediaReady) return;

      await this.adb("shell", "uiautomator", "dump", androidUiDumpPath).catch(() => undefined);
      const hierarchy = await this.adb("shell", "cat", androidUiDumpPath).catch(() => "");
      const nodes = hierarchy.match(/<node\b[^>]*\/>/gu) ?? [];
      lastHierarchy = nodes
        .filter((node) => /microphone|android\.widget\.Button/iu.test(node))
        .join("\n")
        .slice(-6_000);
      const allowNode = nodes.find(
        (node) =>
          /resource-id="[^"]*(?:permission_allow|positive_button)[^"]*"/iu.test(node) ||
          /text="(?:Allow while visiting the site|Allow this time|Allow|While using the app|Only this time|Разрешить|При использовании приложения)"/iu.test(
            node,
          ),
      );
      const bounds = allowNode?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/u);
      if (bounds) {
        const left = Number(bounds[1]);
        const top = Number(bounds[2]);
        const right = Number(bounds[3]);
        const bottom = Number(bounds[4]);
        await this.adb(
          "shell",
          "input",
          "tap",
          String((left + right) / 2),
          String((top + bottom) / 2),
        );
      }
      await delay(300);
    }
    throw new Error(
      `Android Chrome microphone permission prompt could not be accepted:\n${lastHierarchy}`,
    );
  }

  async waitForText(text: string, timeoutMs = 20_000): Promise<void> {
    try {
      await this.waitForTruthy(
        `document.body?.innerText.includes(${JSON.stringify(text)}) === true`,
        timeoutMs,
      );
    } catch (error: unknown) {
      const page = await this.evaluate<{
        readonly body: string;
        readonly href: string;
        readonly title: string;
        readonly microphonePermission: string;
        readonly peerConnections: readonly unknown[];
      }>(`(async () => {
        const peerConnections = [];
        for (const connection of window.__androidPeerConnections ?? []) {
          const reports = [];
          (await connection.getStats()).forEach((report) => {
            if (["candidate-pair", "local-candidate", "remote-candidate"].includes(report.type)) {
              reports.push({
                type: report.type,
                state: report.state,
                protocol: report.protocol,
                address: report.address,
                port: report.port,
                candidateType: report.candidateType,
                nominated: report.nominated,
              });
            }
          });
          peerConnections.push({
            connectionState: connection.connectionState,
            iceConnectionState: connection.iceConnectionState,
            iceGatheringState: connection.iceGatheringState,
            reports,
          });
        }
        return {
          href: location.href,
          title: document.title,
          body: document.body?.innerText ?? "",
          microphonePermission: (await navigator.permissions.query({ name: "microphone" })).state,
          peerConnections,
        };
      })()`);
      throw new Error(
        `Android Chrome did not render ${JSON.stringify(text)}: ${JSON.stringify(page)}`,
        { cause: error },
      );
    }
  }

  async videoCount(): Promise<number> {
    return this.evaluate<number>('document.querySelectorAll("video").length');
  }

  async videoIsLive(): Promise<boolean> {
    return this.evaluate<boolean>(`[...document.querySelectorAll("video")].some((video) => {
      const stream = video.srcObject;
      if (!(stream instanceof MediaStream)) return false;
      const track = stream.getVideoTracks()[0];
      return track?.readyState === "live" && video.videoWidth > 0 && video.videoHeight > 0;
    })`);
  }

  async waitForLiveVideo(): Promise<void> {
    await this.waitForTruthy(`[...document.querySelectorAll("video")].some((video) => {
      const stream = video.srcObject;
      if (!(stream instanceof MediaStream)) return false;
      const track = stream.getVideoTracks()[0];
      return track?.readyState === "live" && video.videoWidth > 0 && video.videoHeight > 0;
    })`);
  }

  async inboundVideoStats(): Promise<AndroidInboundVideoStats> {
    return this.evaluate<AndroidInboundVideoStats>(`(async () => {
      const result = { bytesReceived: 0, framesDecoded: 0, frameWidth: 0, frameHeight: 0 };
      for (const connection of window.__androidPeerConnections ?? []) {
        const reports = await connection.getStats();
        reports.forEach((report) => {
          if (report.type !== "inbound-rtp" || report.kind !== "video") return;
          result.bytesReceived += Number(report.bytesReceived ?? 0);
          result.framesDecoded += Number(report.framesDecoded ?? 0);
          result.frameWidth = Math.max(result.frameWidth, Number(report.frameWidth ?? 0));
          result.frameHeight = Math.max(result.frameHeight, Number(report.frameHeight ?? 0));
        });
      }
      return result;
    })()`);
  }

  async viewport(): Promise<{ readonly width: number; readonly height: number }> {
    return this.evaluate<{ readonly width: number; readonly height: number }>(
      "({ width: innerWidth, height: innerHeight })",
    );
  }

  async rotateLandscape(): Promise<void> {
    await this.adb("shell", "settings", "put", "system", "accelerometer_rotation", "0");
    await this.adb("shell", "settings", "put", "system", "user_rotation", "1");
    await this.waitForTruthy("innerWidth > innerHeight");
  }

  async rotatePortrait(): Promise<void> {
    await this.adb("shell", "settings", "put", "system", "accelerometer_rotation", "0");
    await this.adb("shell", "settings", "put", "system", "user_rotation", "0");
    await this.waitForTruthy("innerHeight > innerWidth");
  }

  async detachedViewerIsActive(): Promise<boolean> {
    return this.evaluate<boolean>(`document.pictureInPictureElement instanceof HTMLVideoElement ||
      [...document.querySelectorAll("section")].some((section) =>
        section.classList.contains("fixed") && section.querySelector("video") !== null
      )`);
  }

  private async waitForCdp(): Promise<void> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try {
        await this.evaluate<string>("location.href", "about:");
        return;
      } catch {
        await delay(250);
      }
    }
    throw new Error("Android Chrome CDP endpoint did not become ready");
  }

  private async waitForTruthy(expression: string, timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.evaluate<boolean>(expression)) return;
      await delay(250);
    }
    throw new Error(`Android Chrome condition timed out: ${expression}`);
  }

  private async evaluate<T>(
    expression: string,
    pageUrlPrefix = this.origin,
    userGesture = false,
  ): Promise<T> {
    const response = await this.call(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true, userGesture },
      "page",
      pageUrlPrefix,
    );
    const value = response.result?.result?.value;
    return value as T;
  }

  private async call(
    method: string,
    params: Readonly<Record<string, unknown>>,
    target: "page" | "browser" = "page",
    pageUrlPrefix = this.origin,
  ): Promise<CdpResponse> {
    const encoded = Buffer.from(JSON.stringify(params)).toString("base64");
    const argumentsList = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      this.cdpScriptPath,
      "-Method",
      method,
      "-ParamsBase64",
      encoded,
      "-Target",
      target,
      "-PageUrlPrefix",
      pageUrlPrefix,
    ];
    const deadline = Date.now() + 10_000;
    let stdout = "";
    while (true) {
      try {
        ({ stdout } = await execFileAsync("powershell.exe", argumentsList, { timeout: 15_000 }));
        break;
      } catch (error: unknown) {
        if (Date.now() >= deadline) throw error;
        await delay(250);
      }
    }
    const parsed: unknown = JSON.parse(stdout.trim());
    if (!isCdpResponse(parsed)) throw new Error(`Invalid CDP response for ${method}`);
    if (parsed.error) {
      const message =
        typeof parsed.error.message === "string" ? parsed.error.message : `CDP ${method} failed`;
      throw new Error(message);
    }
    return parsed;
  }

  private async adb(...args: readonly string[]): Promise<string> {
    const { stdout } = await execFileAsync(this.adbPath, [...args]);
    return stdout;
  }
}

function isCdpResponse(value: unknown): value is CdpResponse {
  return typeof value === "object" && value !== null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
