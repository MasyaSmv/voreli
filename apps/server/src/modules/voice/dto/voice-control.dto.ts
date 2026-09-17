import type { SetVoiceModeratorStatePayload, SetVoiceSelfStatePayload } from "@voreli/shared";
import { IsBoolean, IsString, Length } from "class-validator";

const ID_MAX_LENGTH = 64;

export class SetVoiceSelfStateDto implements SetVoiceSelfStatePayload {
  @IsBoolean()
  selfMuted!: boolean;

  @IsBoolean()
  selfDeafened!: boolean;
}

export class SetVoiceModeratorStateDto implements SetVoiceModeratorStatePayload {
  @IsString()
  @Length(1, ID_MAX_LENGTH)
  channelId!: string;

  @IsString()
  @Length(1, ID_MAX_LENGTH)
  userId!: string;

  @IsBoolean()
  moderatorMuted!: boolean;

  @IsBoolean()
  moderatorDeafened!: boolean;
}
