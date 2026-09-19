import type {
  ScreenSharePayload,
  ScreenShareVisibilityPayload,
  StartScreenSharePayload,
} from "@voreli/shared";
import { IsBoolean, IsIn, IsOptional, IsString, Length } from "class-validator";

const ID_MAX_LENGTH = 128;

export class StartScreenShareDto implements StartScreenSharePayload {
  @IsString()
  @Length(1, ID_MAX_LENGTH)
  mediaRoomId!: string;

  @IsString()
  @Length(1, ID_MAX_LENGTH)
  videoProducerId!: string;

  @IsOptional()
  @IsString()
  @Length(1, ID_MAX_LENGTH)
  audioProducerId?: string;
}

export class ScreenShareDto implements ScreenSharePayload {
  @IsString()
  @Length(1, ID_MAX_LENGTH)
  mediaRoomId!: string;

  @IsString()
  @Length(1, ID_MAX_LENGTH)
  screenStreamId!: string;
}

export class ScreenShareLayerDto extends ScreenShareDto {
  @IsIn([0, 1, 2])
  spatialLayer!: 0 | 1 | 2;
}

export class ScreenShareVisibilityDto
  extends ScreenShareDto
  implements ScreenShareVisibilityPayload
{
  @IsBoolean()
  visible!: boolean;
}
