import type { CallConnectionQualityEvent, CallIdPayload, StartCallPayload } from "@voreli/shared";
import { IsIn, IsString, Length } from "class-validator";

const ID_MAX_LENGTH = 64;
const CLIENT_NONCE_MAX_LENGTH = 128;

export class StartCallDto implements StartCallPayload {
  @IsString()
  @Length(1, ID_MAX_LENGTH)
  conversationId!: string;

  @IsString()
  @Length(1, CLIENT_NONCE_MAX_LENGTH)
  clientNonce!: string;
}

export class CallIdDto implements CallIdPayload {
  @IsString()
  @Length(1, ID_MAX_LENGTH)
  callId!: string;
}

export class CallConnectionQualityDto extends CallIdDto implements CallConnectionQualityEvent {
  @IsIn(["good", "constrained", "poor", "unknown"])
  quality!: CallConnectionQualityEvent["quality"];
}
