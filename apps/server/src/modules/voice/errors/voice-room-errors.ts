import { DomainError } from "../../../common/errors/domain-error.js";

export class VoiceChannelNotAvailableError extends DomainError {
  static readonly CODE = "VOICE_CHANNEL_NOT_AVAILABLE";
  readonly errorCode = VoiceChannelNotAvailableError.CODE;

  constructor() {
    super("Voice channel does not exist or cannot be joined");
  }
}

export class VoiceConnectForbiddenError extends DomainError {
  static readonly CODE = "VOICE_CONNECT_FORBIDDEN";
  readonly errorCode = VoiceConnectForbiddenError.CODE;

  constructor() {
    super("Connecting to this voice channel is not allowed");
  }
}

export class VoiceChannelFullError extends DomainError {
  static readonly CODE = "VOICE_CHANNEL_FULL";
  readonly errorCode = VoiceChannelFullError.CODE;

  constructor() {
    super("Voice channel is full");
  }
}

export class VoiceRoomOnAnotherInstanceError extends DomainError {
  static readonly CODE = "VOICE_ROOM_ON_ANOTHER_INSTANCE";
  readonly errorCode = VoiceRoomOnAnotherInstanceError.CODE;

  constructor(readonly instanceId: string) {
    super("Voice room is owned by another server instance");
  }

  override context(): Readonly<Record<string, unknown>> {
    return { instanceId: this.instanceId };
  }
}

export class VoiceSessionEvictingError extends DomainError {
  static readonly CODE = "VOICE_SESSION_EVICTING";
  readonly errorCode = VoiceSessionEvictingError.CODE;

  constructor() {
    super("Previous voice session is being closed; retry the join");
  }
}
