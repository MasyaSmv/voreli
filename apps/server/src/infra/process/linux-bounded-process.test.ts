import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LinuxBoundedProcess } from "./linux-bounded-process.js";

describe("LinuxBoundedProcess with real OS limits", () => {
  let host: LinuxBoundedProcess;
  let directory: string;
  const budget = {
    addressSpaceBytes: 1024 * 1024 * 1024,
    cpuSeconds: 3,
    wallMilliseconds: 3_000,
    outputBytes: 1024,
  };
  beforeEach(async () => {
    host = new LinuxBoundedProcess();
    directory = await mkdtemp(join(tmpdir(), "voreli-process-"));
  });
  afterEach(async () => {
    await host.onModuleDestroy();
    await rm(directory, { recursive: true, force: true });
  });
  async function script(source: string): Promise<URL> {
    const path = join(directory, "child.mjs");
    await writeFile(path, source);
    return pathToFileURL(path);
  }

  it("transfers binary input and waits for a successful exit", async () => {
    const child = await script("process.stdin.pipe(process.stdout);");
    const bytes = Buffer.from([0, 255, 1, 128]);
    const result = await host.run(child, [], bytes, budget);
    expect(result.code).toBe(0);
    expect(result.stdout).toEqual(bytes);
  });

  it("kills an unresponsive process and observes its disappearance before rejecting", async () => {
    const pidFile = join(directory, "pid");
    const child = await script(`
      import { writeFileSync } from 'node:fs';
      writeFileSync(process.argv[2], String(process.pid));
      for (;;) {}
    `);
    await expect(
      host.run(child, [pidFile], Buffer.alloc(0), { ...budget, wallMilliseconds: 1_000 }),
    ).rejects.toMatchObject({ errorCode: "PROCESS_LIMIT_EXCEEDED", reason: "deadline" });
    const pid = Number(await readFile(pidFile, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
    expect(
      (
        await host.run(await script("process.stdout.write('alive');"), [], Buffer.alloc(0), budget)
      ).stdout.toString(),
    ).toBe("alive");
  });

  it("enforces kernel address space limits on native Buffer allocations", async () => {
    const child = await script(`
      import { readFileSync } from 'node:fs';
      process.stdout.write(readFileSync('/proc/self/limits', 'utf8').split('\\n').find(line => line.startsWith('Max address space')) + '\\n');
      try { Buffer.alloc(2 * 1024 * 1024 * 1024); process.exitCode = 9; }
      catch (error) { console.warn(error); process.stdout.write('allocation refused'); }
    `);
    const result = await host.run(child, [], Buffer.alloc(0), { ...budget, outputBytes: 4096 });
    expect(result.code).toBe(0);
    expect(result.stdout.toString()).toMatch(/Max address space\s+1073741824\s+1073741824/);
    expect(result.stdout.toString()).toContain("allocation refused");
  });

  it("kills a process flooding output", async () => {
    const child = await script("setInterval(() => process.stdout.write(Buffer.alloc(2048)), 1);");
    await expect(host.run(child, [], Buffer.alloc(0), budget)).rejects.toMatchObject({
      errorCode: "PROCESS_LIMIT_EXCEEDED",
      reason: "output",
    });
  });

  it("shuts down active processes and refuses new work", async () => {
    const child = await script("setInterval(() => {}, 1000);");
    const running = host.run(child, [], Buffer.alloc(0), budget);
    const rejected = expect(running).rejects.toMatchObject({ errorCode: "PROCESS_UNAVAILABLE" });
    await host.onModuleDestroy();
    await rejected;
    await expect(host.run(child, [], Buffer.alloc(0), budget)).rejects.toMatchObject({
      errorCode: "PROCESS_UNAVAILABLE",
    });
  });

  it("reports startup failure instead of treating it as valid output", async () => {
    const result = await host.run(
      pathToFileURL(join(directory, "missing.mjs")),
      [],
      Buffer.alloc(0),
      budget,
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("MODULE_NOT_FOUND");
  });
});
