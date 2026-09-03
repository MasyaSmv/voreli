import { USERNAME_MAX_LENGTH, PASSWORD_MAX_LENGTH } from "@voreli/shared";
import { Transform } from "class-transformer";
import { IsString, Length } from "class-validator";

export class LoginDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toLowerCase().trim() : value,
  )
  @IsString()
  @Length(1, USERNAME_MAX_LENGTH)
  username!: string;

  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password!: string;
}
