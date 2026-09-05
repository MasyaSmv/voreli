export class VoiceRequestError extends Error {
  constructor(
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = "VoiceRequestError";
  }
}
