import {
  DISPLAY_NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
} from "@voreli/shared";
import { Transform } from "class-transformer";
import { IsOptional, IsString, Length, Matches } from "class-validator";

export class RegisterDto {
  @IsString()
  @Length(1, 64)
  inviteCode!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toLowerCase().trim() : value,
  )
  @IsString()
  @Length(USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH)
  @Matches(USERNAME_PATTERN, {
    message: "username may contain lowercase letters, digits, dot, underscore and dash only",
  })
  username!: string;

  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  password!: string;

  @IsOptional()
  @IsString()
  @Length(1, DISPLAY_NAME_MAX_LENGTH)
  displayName?: string;
}
