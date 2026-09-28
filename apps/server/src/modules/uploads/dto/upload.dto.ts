import { Transform } from "class-transformer";
import { IsIn, IsInt, IsString, Length, Matches, Max, Min } from "class-validator";

export class ReserveUploadDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(1, 255)
  fileName!: string;

  @IsInt()
  @Min(1)
  @Max(25 * 1024 * 1024)
  byteSize!: number;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toLowerCase().trim() : value,
  )
  @IsString()
  @Length(1, 127)
  declaredMime!: string;

  @IsIn(["attachment", "avatar"])
  purpose!: "attachment" | "avatar";
}

export class CompleteUploadDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toLowerCase() : value,
  )
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  checksumSha256!: string;
}

export class SetAvatarDto {
  @IsString()
  @Length(1, 64)
  uploadId!: string;
}
