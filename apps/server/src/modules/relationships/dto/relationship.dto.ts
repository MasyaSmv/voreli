import { ContactAudience, type ContactAudience as ContactAudienceValue } from "@voreli/shared";
import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, Length, Matches } from "class-validator";

const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

function normalizePublicUsername(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return (trimmed.startsWith("@") ? trimmed.slice(1) : trimmed).toLowerCase();
}

export class UsernameQueryDto {
  @Transform(({ value }: { value: unknown }) => normalizePublicUsername(value))
  @IsString()
  @Length(3, 32)
  @Matches(USERNAME_PATTERN)
  username!: string;
}

export class UsernameBodyDto extends UsernameQueryDto {}

const CONTACT_AUDIENCES = Object.values(ContactAudience);

export class UpdateContactSettingsDto {
  @IsOptional()
  @IsIn(CONTACT_AUDIENCES)
  directMessageAudience?: ContactAudienceValue;

  @IsOptional()
  @IsIn(CONTACT_AUDIENCES)
  directCallAudience?: ContactAudienceValue;

  @IsOptional()
  @IsIn(CONTACT_AUDIENCES)
  friendRequestAudience?: ContactAudienceValue;
}
