import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateSceneDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsObject()
  data?: object;

  @IsOptional()
  @IsBoolean()
  is_public?: boolean;

  @IsOptional()
  @IsString()
  thumbnail?: string;
}
