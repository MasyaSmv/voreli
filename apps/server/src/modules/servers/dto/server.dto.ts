import {
  CATEGORY_NAME_MAX_LENGTH,
  CHANNEL_NAME_MAX_LENGTH,
  CHANNEL_TOPIC_MAX_LENGTH,
  ROLE_NAME_MAX_LENGTH,
  SERVER_NAME_MAX_LENGTH,
} from "@voreli/shared";
import {
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from "class-validator";

export class CreateServerDto {
  @IsString()
  @Length(1, SERVER_NAME_MAX_LENGTH)
  name!: string;
}

export class UpdateServerDto {
  @IsOptional()
  @IsString()
  @Length(1, SERVER_NAME_MAX_LENGTH)
  name?: string;
}

export class CreateCategoryDto {
  @IsString()
  @Length(1, CATEGORY_NAME_MAX_LENGTH)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @Length(1, CATEGORY_NAME_MAX_LENGTH)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

export class CreateChannelDto {
  @IsString()
  @Length(1, CHANNEL_NAME_MAX_LENGTH)
  name!: string;

  @IsIn(["TEXT", "VOICE"])
  type!: "TEXT" | "VOICE";

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @Length(0, CHANNEL_TOPIC_MAX_LENGTH)
  topic?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

export class UpdateChannelDto {
  @IsOptional()
  @IsString()
  @Length(1, CHANNEL_NAME_MAX_LENGTH)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, CHANNEL_TOPIC_MAX_LENGTH)
  topic?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

export class CreateRoleDto {
  @IsString()
  @Length(1, ROLE_NAME_MAX_LENGTH)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(0xffffff)
  color?: number;

  /** Decimal string: JSON has no bigint, and the mask is 64-bit. */
  @IsOptional()
  @IsNumberString({ no_symbols: true })
  permissions?: string;
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @Length(1, ROLE_NAME_MAX_LENGTH)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(0xffffff)
  color?: number;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  permissions?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

export class SetOverrideDto {
  @IsOptional()
  @IsString()
  roleId?: string;

  @IsOptional()
  @IsString()
  memberId?: string;

  @IsNumberString({ no_symbols: true })
  allow!: string;

  @IsNumberString({ no_symbols: true })
  deny!: string;
}

export class CreateInviteDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxUses?: number;

  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(60 * 60 * 24 * 365)
  expiresInSeconds?: number;
}
