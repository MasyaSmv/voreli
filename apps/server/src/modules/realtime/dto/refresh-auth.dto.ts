import type { RefreshAuthPayload } from "@voreli/shared";
import { IsString, Length } from "class-validator";

export class RefreshAuthDto implements RefreshAuthPayload {
  @IsString()
  @Length(1, 8192)
  accessToken!: string;
}
