import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PROCESS_CLOSE_TIMEOUT_MS = 5_000;

export interface VirtualMicrophone {
  readonly label: string;
  readonly sinkName: string;
  readonly sourceName: string;
}

export interface VirtualOutput {
  readonly label: string;
  readonly sinkName: string;
}

/** Owns every PulseAudio module and temporary sample created by one browser test. */
export class PulseAudioHarness {
  private readonly moduleIds: string[] = [];
  private readonly microphoneModules = new WeakMap<
    VirtualMicrophone,
    { readonly sinkModuleId: string; readonly sourceModuleId: string }
  >();
  private temporaryDirectory: string | undefined;

  static async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync("pactl", ["info"]);
      await execFileAsync("paplay", ["--version"]);
      await execFileAsync("parec", ["--version"]);
      return true;
    } catch {
      return false;
    }
  }

  async createMicrophone(name: string, label: string): Promise<VirtualMicrophone> {
    const sinkName = `${name}_sink`;
    const sourceName = `${name}_source`;
    const sinkModuleId = await this.loadModule("module-null-sink", [
      `sink_name=${sinkName}`,
      `sink_properties=device.description=${label}_backing_sink`,
    ]);
    const sourceModuleId = await this.loadModule("module-virtual-source", [
      `source_name=${sourceName}`,
      `master=${sinkName}.monitor`,
      `source_properties=device.description=${label}`,
    ]);
    await this.waitFor("sources", sourceName, true);
    const microphone = { label, sinkName, sourceName };
    this.microphoneModules.set(microphone, { sinkModuleId, sourceModuleId });
    return microphone;
  }

  async createOutput(name: string, label: string): Promise<VirtualOutput> {
    await this.loadModule("module-null-sink", [
      `sink_name=${name}`,
      `sink_properties=device.description=${label}`,
    ]);
    await this.waitFor("sinks", name, true);
    return { label, sinkName: name };
  }

  async setDefaultMicrophone(microphone: VirtualMicrophone): Promise<void> {
    await execFileAsync("pactl", ["set-default-source", microphone.sourceName]);
  }

  async setDefaultOutput(output: VirtualOutput): Promise<void> {
    await execFileAsync("pactl", ["set-default-sink", output.sinkName]);
  }

  async stopServer(): Promise<void> {
    await execFileAsync("pulseaudio", ["--kill"]);
    this.moduleIds.length = 0;
    await this.waitForServer(false);
  }

  async removeMicrophone(microphone: VirtualMicrophone): Promise<void> {
    const modules = this.microphoneModules.get(microphone);
    if (!modules) throw new Error("Microphone modules are not owned");
    const { sourceModuleId, sinkModuleId } = modules;
    await this.unloadModule(sourceModuleId);
    await this.unloadModule(sinkModuleId);
    this.microphoneModules.delete(microphone);
    await this.waitFor("sources", microphone.sourceName, false);
  }

  async playSine(sinkName: string, durationMs = 2_000): Promise<void> {
    const samplePath = await this.sineSample(durationMs);
    await execFileAsync("paplay", [`--device=${sinkName}`, samplePath]);
  }

  async recordSink(sinkName: string, action: () => Promise<void>): Promise<number> {
    const recorder = spawn(
      "parec",
      [
        `--device=${sinkName}.monitor`,
        "--format=s16le",
        "--rate=48000",
        "--channels=1",
        "--latency-msec=20",
      ],
      { stdio: "pipe" },
    );
    const chunks: Buffer[] = [];
    let stderr = "";
    recorder.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    recorder.stderr.setEncoding("utf8");
    recorder.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    await waitForSpawn(recorder);
    try {
      await action();
      await new Promise((resolve) => setTimeout(resolve, 750));
    } finally {
      await stopProcess(recorder);
    }
    const samples = Buffer.concat(chunks);
    if (samples.length === 0 && stderr.trim())
      throw new Error(`parec produced no audio: ${stderr}`);
    return peakPcm16(samples);
  }

  async close(): Promise<void> {
    for (const moduleId of [...this.moduleIds].reverse()) {
      await this.unloadModule(moduleId).catch((error: unknown) => {
        console.error("Failed to unload PulseAudio test module", { error, moduleId });
      });
    }
    this.moduleIds.length = 0;
    if (this.temporaryDirectory)
      await rm(this.temporaryDirectory, { recursive: true, force: true });
    this.temporaryDirectory = undefined;
  }

  private async loadModule(module: string, arguments_: readonly string[]): Promise<string> {
    const { stdout } = await execFileAsync("pactl", ["load-module", module, ...arguments_]);
    const moduleId = stdout.trim();
    if (!/^\d+$/.test(moduleId)) throw new Error(`pactl did not return a module id: ${stdout}`);
    this.moduleIds.push(moduleId);
    return moduleId;
  }

  private async unloadModule(moduleId: string): Promise<void> {
    const index = this.moduleIds.lastIndexOf(moduleId);
    if (index >= 0) this.moduleIds.splice(index, 1);
    await execFileAsync("pactl", ["unload-module", moduleId]);
  }

  private async waitFor(
    kind: "sources" | "sinks",
    name: string,
    shouldExist: boolean,
  ): Promise<void> {
    const deadline = Date.now() + 5_000;
    do {
      const { stdout } = await execFileAsync("pactl", ["list", "short", kind]);
      const exists = stdout.split("\n").some((line) => line.split("\t")[1] === name);
      if (exists === shouldExist) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    throw new Error(
      `PulseAudio ${kind} ${name} did not become ${shouldExist ? "ready" : "absent"}`,
    );
  }

  private async waitForServer(shouldBeReady: boolean): Promise<void> {
    const deadline = Date.now() + 5_000;
    do {
      const ready = await execFileAsync("pactl", ["info"])
        .then(() => true)
        .catch(() => false);
      if (ready === shouldBeReady) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    throw new Error(`PulseAudio server did not become ${shouldBeReady ? "ready" : "unavailable"}`);
  }

  private async sineSample(durationMs: number): Promise<string> {
    if (!this.temporaryDirectory) {
      this.temporaryDirectory = await mkdtemp(join(tmpdir(), "voreli-audio-e2e-"));
    }
    const samplePath = join(this.temporaryDirectory, `sine-${durationMs}.wav`);
    await writeFile(samplePath, createSineWave(durationMs));
    return samplePath;
  }
}

function createSineWave(durationMs: number): Buffer {
  const sampleRate = 48_000;
  const sampleCount = Math.ceil((sampleRate * durationMs) / 1_000);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 12_000);
    buffer.writeInt16LE(sample, 44 + index * 2);
  }
  return buffer;
}

function peakPcm16(buffer: Buffer): number {
  let peak = 0;
  for (let offset = 0; offset + 1 < buffer.length; offset += 2) {
    peak = Math.max(peak, Math.abs(buffer.readInt16LE(offset)));
  }
  return peak;
}

function waitForSpawn(process: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    process.once("spawn", resolve);
    process.once("error", reject);
  });
}

function stopProcess(process: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.exitCode !== null) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      process.kill("SIGKILL");
      reject(new Error("Timed out waiting for parec to close"));
    }, PROCESS_CLOSE_TIMEOUT_MS);
    process.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
    process.kill("SIGINT");
  });
}
