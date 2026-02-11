import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";
import { Type } from "class-transformer";

export class ListScenesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsIn(["public", "mine"])
  filter?: "public" | "mine";
}
