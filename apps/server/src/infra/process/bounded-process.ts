export const BOUNDED_PROCESS = Symbol("BOUNDED_PROCESS");

export interface ProcessBudget {
  readonly addressSpaceBytes: number;
  readonly cpuSeconds: number;
  readonly wallMilliseconds: number;
  readonly outputBytes: number;
}

export interface ProcessResult {
  readonly stdout: Buffer;
  readonly stderr: string;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface BoundedProcess {
  run(
    script: URL,
    args: readonly string[],
    input: Uint8Array,
    budget: ProcessBudget,
  ): Promise<ProcessResult>;
}
