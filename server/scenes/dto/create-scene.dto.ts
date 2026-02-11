import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateSceneDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsObject()
  data!: object;

  @IsOptional()
  @IsBoolean()
  is_public?: boolean;
}
