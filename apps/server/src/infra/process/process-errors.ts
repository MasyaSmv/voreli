export class ProcessLimitError extends Error {
  static readonly CODE = "PROCESS_LIMIT_EXCEEDED";
  readonly errorCode = ProcessLimitError.CODE;

  constructor(readonly reason: "deadline" | "output") {
    super(`Child process exceeded ${reason} budget`);
  }
}

export class ProcessUnavailableError extends Error {
  static readonly CODE = "PROCESS_UNAVAILABLE";
  readonly errorCode = ProcessUnavailableError.CODE;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
