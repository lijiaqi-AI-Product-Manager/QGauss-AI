import { IsBoolean, IsInt, IsOptional, IsString, Length, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

export class FavoriteAppDto {
  @Transform(({ obj, key }) => obj[key])
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() favorited?: boolean;
}

export class CreateCategoryDto {
  @IsString() @Length(1, 32) name: string;
  @IsOptional() @IsInt() sort?: number;
}

export class UpdateCategoryDto {
  @IsOptional() @IsString() @Length(1, 32) name?: string;
  @IsOptional() @IsInt() sort?: number;
}

export class CreateAppDto {
  @IsOptional() @IsString() categoryId?: string;
  @IsString() @Length(1, 64) name: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() icon?: string;
  @IsString() @Length(1, 8000) systemPrompt: string;
  @IsOptional() @IsString() defaultModel?: string;
  @IsOptional() @IsString() greeting?: string;
  @IsOptional() @IsBoolean() published?: boolean;
  @IsOptional() @IsInt() sort?: number;
}

export class UpdateAppDto {
  @IsOptional() @IsString() categoryId?: string | null;
  @IsOptional() @IsString() @Length(1, 64) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsString() @Length(1, 8000) systemPrompt?: string;
  @IsOptional() @IsString() defaultModel?: string | null;
  @IsOptional() @IsString() greeting?: string;
  @IsOptional() @IsBoolean() published?: boolean;
  @IsOptional() @IsInt() sort?: number;
}
