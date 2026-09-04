import { DomainError } from "../../../common/errors/domain-error.js";

export class VoiceSessionNotFoundError extends DomainError {
  static readonly CODE = "VOICE_SESSION_NOT_FOUND";
  readonly errorCode = VoiceSessionNotFoundError.CODE;

  constructor() {
    super("Voice session does not exist");
  }
}

export class VoiceMediaObjectNotFoundError extends DomainError {
  static readonly CODE = "VOICE_MEDIA_OBJECT_NOT_FOUND";
  readonly errorCode = VoiceMediaObjectNotFoundError.CODE;

  constructor() {
    super("Media object does not exist or does not belong to this voice session");
  }
}

export class VoiceMediaObjectLimitError extends DomainError {
  static readonly CODE = "VOICE_MEDIA_OBJECT_LIMIT";
  readonly errorCode = VoiceMediaObjectLimitError.CODE;

  constructor(readonly objectKind: "transport" | "producer" | "consumer") {
    super(`Voice session has reached its ${objectKind} limit`);
  }

  override context(): Readonly<Record<string, unknown>> {
    return { objectKind: this.objectKind };
  }
}

export class VoiceInvalidTransportDirectionError extends DomainError {
  static readonly CODE = "VOICE_INVALID_TRANSPORT_DIRECTION";
  readonly errorCode = VoiceInvalidTransportDirectionError.CODE;

  constructor() {
    super("Media operation is not allowed on this transport direction");
  }
}

export class VoiceCannotConsumeError extends DomainError {
  static readonly CODE = "VOICE_CANNOT_CONSUME";
  readonly errorCode = VoiceCannotConsumeError.CODE;

  constructor() {
    super("Producer cannot be consumed in this voice session");
  }
}
