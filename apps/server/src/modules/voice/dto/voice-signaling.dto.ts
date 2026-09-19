import type {
  ConnectTransportPayload,
  CreateConsumerPayload,
  CreateProducerPayload,
  CreateTransportPayload,
  RestartIcePayload,
  ResumeConsumerPayload,
} from "@voreli/shared";
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Validate,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from "class-validator";

const ID_MAX_LENGTH = 128;

@ValidatorConstraint({ name: "exactlyOneMediaRoomIdentifier", async: false })
class ExactlyOneMediaRoomIdentifier implements ValidatorConstraintInterface {
  validate(_value: unknown, arguments_: ValidationArguments): boolean {
    const value = arguments_.object as VoiceJoinDto;
    const hasChannelId = typeof value.channelId === "string";
    const hasMediaRoomId = typeof value.mediaRoomId === "string";

    return hasChannelId !== hasMediaRoomId;
  }
}

export class VoiceJoinDto {
  @IsOptional()
  @IsString()
  @Length(1, ID_MAX_LENGTH)
  channelId?: string;

  @IsOptional()
  @IsString()
  @Length(1, ID_MAX_LENGTH)
  mediaRoomId?: string;

  @IsOptional()
  @IsString()
  @Length(1, ID_MAX_LENGTH)
  sessionId?: string;

  @Validate(ExactlyOneMediaRoomIdentifier)
  private readonly roomIdentifierSelection?: never;
}

export class CreateTransportDto implements CreateTransportPayload {
  @IsIn(["send", "recv"])
  direction!: CreateTransportPayload["direction"];
}

export class ConnectTransportDto implements ConnectTransportPayload {
  @IsString()
  @Length(1, ID_MAX_LENGTH)
  transportId!: string;

  @IsObject()
  dtlsParameters!: ConnectTransportPayload["dtlsParameters"];
}

export class RestartIceDto implements RestartIcePayload {
  @IsString()
  @Length(1, ID_MAX_LENGTH)
  transportId!: string;
}

export class CreateProducerDto implements CreateProducerPayload {
  @IsString()
  @Length(1, ID_MAX_LENGTH)
  transportId!: string;

  @IsIn(["audio", "video"])
  kind!: CreateProducerPayload["kind"];

  @IsObject()
  rtpParameters!: CreateProducerPayload["rtpParameters"];

  @IsIn(["microphone", "screen-video", "screen-audio"])
  source!: CreateProducerPayload["source"];

  @IsOptional()
  @IsString()
  @Length(1, ID_MAX_LENGTH)
  screenStreamId?: string;
}

export class CreateConsumerDto implements CreateConsumerPayload {
  @IsString()
  @Length(1, ID_MAX_LENGTH)
  transportId!: string;

  @IsString()
  @Length(1, ID_MAX_LENGTH)
  producerId!: string;

  @IsObject()
  rtpCapabilities!: CreateConsumerPayload["rtpCapabilities"];
}

export class ResumeConsumerDto implements ResumeConsumerPayload {
  @IsString()
  @Length(1, ID_MAX_LENGTH)
  consumerId!: string;
}
