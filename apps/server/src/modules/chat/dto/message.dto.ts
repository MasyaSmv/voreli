import { MESSAGE_MAX_LENGTH, MESSAGE_PAGE_MAX_SIZE } from "@voreli/shared";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";

export class HistoryQueryDto {
  /** Id of the oldest message already on screen; the page returned is older than it. */
  @IsOptional()
  @IsString()
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MESSAGE_PAGE_MAX_SIZE)
  limit?: number;
}

export class EditMessageDto {
  @IsString()
  @Length(1, MESSAGE_MAX_LENGTH)
  text!: string;
}
