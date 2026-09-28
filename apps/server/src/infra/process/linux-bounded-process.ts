import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";

import { Injectable, type OnModuleDestroy } from "@nestjs/common";

import type { BoundedProcess, ProcessBudget, ProcessResult } from "./bounded-process.js";
import { ProcessLimitError, ProcessUnavailableError } from "./process-errors.js";

@Injectable()
export class LinuxBoundedProcess implements BoundedProcess, OnModuleDestroy {
  private readonly active = new Map<ChildProcessWithoutNullStreams, () => void>();
  private stopping = false;

  run(
    script: URL,
    args: readonly string[],
    input: Uint8Array,
    budget: ProcessBudget,
  ): Promise<ProcessResult> {
    if (this.stopping || process.platform !== "linux") {
      return Promise.reject(
        new ProcessUnavailableError("Bounded processing requires a running Linux host"),
      );
    }
    return new Promise((resolve, reject) => {
      const child = spawn(
        "/usr/bin/prlimit",
        [
          `--as=${String(budget.addressSpaceBytes)}`,
          `--cpu=${String(budget.cpuSeconds)}`,
          "--core=0",
          "--",
          process.execPath,
          "--jitless",
          "--max-old-space-size=128",
          "--disable-wasm-trap-handler",
          fileURLToPath(script),
          ...args,
        ],
        {
          // Do not pass application credentials, NODE_OPTIONS or allocator settings to the decoder.
          env: {
            PATH: "/usr/bin:/bin",
            MALLOC_ARENA_MAX: "2",
            UV_THREADPOOL_SIZE: "1",
            VIPS_CONCURRENCY: "1",
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputSize = 0;
      let failure: Error | undefined;
      let settled = false;
      let closeTimer: NodeJS.Timeout | undefined;
      const finish = (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        clearTimeout(closeTimer);
        this.active.delete(child);
        if (failure) reject(failure);
        else
          resolve({
            stdout: Buffer.concat(stdout),
            stderr: Buffer.concat(stderr).toString("utf8"),
            code,
            signal,
          });
      };
      const terminate = (error: Error) => {
        failure ??= error;
        if (closeTimer) return;
        child.kill("SIGKILL");
        closeTimer = setTimeout(() => {
          failure = new ProcessUnavailableError("Child process did not close after SIGKILL", {
            cause: failure,
          });
          child.stdin.destroy();
          child.stdout.destroy();
          child.stderr.destroy();
          child.unref();
          finish(null, null);
        }, 2_000);
      };
      const deadline = setTimeout(
        () => terminate(new ProcessLimitError("deadline")),
        budget.wallMilliseconds,
      );
      this.active.set(child, () =>
        terminate(new ProcessUnavailableError("Process host is shutting down")),
      );
      const collect = (chunks: Buffer[], bytes: Buffer) => {
        if (failure) return;
        outputSize += bytes.length;
        if (outputSize > budget.outputBytes) terminate(new ProcessLimitError("output"));
        else chunks.push(bytes);
      };
      child.stdout.on("data", (bytes: Buffer) => collect(stdout, bytes));
      child.stderr.on("data", (bytes: Buffer) => collect(stderr, bytes));
      child.on("error", (error) =>
        terminate(new ProcessUnavailableError("Failed to run child process", { cause: error })),
      );
      child.stdin.on("error", (error: NodeJS.ErrnoException) => {
        // A decoder may reject its header and exit before the entire input has been written.
        if (error.code !== "EPIPE")
          terminate(new ProcessUnavailableError("Failed to write child input", { cause: error }));
      });
      child.on("close", finish);
      child.stdin.end(input);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await Promise.all(
      [...this.active].map(
        ([child, terminate]) =>
          new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 2_100);
            child.once("close", () => {
              clearTimeout(timer);
              resolve();
            });
            terminate();
          }),
      ),
    );
  }
}
